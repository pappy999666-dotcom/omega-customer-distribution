// dist/core/CoreClient.js
import { randomUUID } from "node:crypto";

// ../omega-protocol/dist/index.js
var PROTOCOL_VERSION = 1;
function isDeploymentIdentity(value) {
  if (!value || typeof value !== "object")
    return false;
  const record = value;
  return ["clientId", "deploymentId", "workspaceId", "licenseId", "agentVersion", "createdAt", "status"].every((key) => typeof record[key] === "string") && typeof record.protocolVersion === "number" && ["ACTIVE", "SUSPENDED", "REVOKED", "UPDATING", "OFFLINE"].includes(String(record.status));
}
function isReleaseMetadata(value) {
  if (!value || typeof value !== "object")
    return false;
  const record = value;
  return ["version", "buildId", "sha256", "signature", "compatibleNode", "compatibleProtocol", "publishedAt", "artifactUrl"].every((key) => typeof record[key] === "string" && String(record[key]).length > 0) && /^[a-f0-9]{64}$/iu.test(String(record.sha256));
}

// dist/core/CoreClient.js
var CoreApiError = class extends Error {
  code;
  requestId;
  retryable;
  status;
  constructor(input) {
    super(input.message);
    this.name = "CoreApiError";
    this.code = input.code;
    this.requestId = input.requestId;
    this.retryable = input.retryable;
    this.status = input.status;
  }
};
function ensureHttps(apiUrl) {
  const parsed = new URL(apiUrl);
  if (parsed.protocol !== "https:")
    throw new Error("Omega Core API must use HTTPS.");
  return parsed.toString().replace(/\/+$/u, "");
}
function retryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}
function backoff(attempt) {
  return Math.min(5e3, 250 * 2 ** attempt) + Math.floor(Math.random() * 100);
}
var CoreClient = class {
  apiUrl;
  timeoutMs;
  fetchImpl;
  accessToken;
  registrationSecret;
  constructor(options) {
    this.apiUrl = ensureHttps(options.apiUrl);
    this.timeoutMs = Math.min(3e4, Math.max(2e3, options.timeoutMs ?? 1e4));
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.accessToken = options.accessToken;
    this.registrationSecret = options.registrationSecret;
  }
  setAccessToken(accessToken) {
    this.accessToken = accessToken;
  }
  async register(request) {
    const value = await this.request("/v1/agent/register", {
      method: "POST",
      body: request,
      authenticated: false
    });
    if (!isDeploymentIdentity(value.identity) || !value.accessToken || !value.capabilities) {
      throw new Error("Core returned an invalid registration response.");
    }
    this.accessToken = value.accessToken;
    return value;
  }
  async rotateCredential() {
    const value = await this.request("/v1/agent/rotate", {
      method: "POST",
      authenticated: true
    });
    if (!value.accessToken || !value.keyId || !value.previousExpiresAt)
      throw new Error("Core returned an invalid rotation response.");
    this.accessToken = value.accessToken;
    return value;
  }
  async heartbeat(request) {
    const value = await this.request("/v1/agent/heartbeat", {
      method: "POST",
      body: request,
      authenticated: true
    });
    if (!value || typeof value.serverTime !== "string" || typeof value.deploymentStatus !== "string") {
      throw new Error("Core returned an invalid heartbeat response.");
    }
    if (value.capabilities)
      this.assertCapabilities(value.capabilities);
    if (value.updateAvailable && !isReleaseMetadata(value.updateAvailable)) {
      throw new Error("Core returned invalid update metadata.");
    }
    return value;
  }
  async getCapabilities() {
    const value = await this.request("/v1/agent/capabilities", { method: "GET", authenticated: true });
    this.assertCapabilities(value);
    return value;
  }
  async getConfiguration() {
    return this.request("/v1/agent/config", { method: "GET", authenticated: true });
  }
  async getStorageLease() {
    const value = await this.request("/v1/agent/storage", { method: "GET", authenticated: true });
    if (!value || typeof value !== "object")
      throw new Error("Core returned an invalid storage lease.");
    const lease = value;
    if (typeof lease.deploymentId !== "string" || typeof lease.workspaceId !== "string" || !["CUSTOMER", "HOSTED", "DISABLED"].includes(String(lease.mode)) || typeof lease.revision !== "number" || typeof lease.issuedAt !== "string") {
      throw new Error("Core returned an invalid storage lease.");
    }
    return value;
  }
  async updateStorageLease(update) {
    const value = await this.request("/v1/agent/storage", { method: "POST", body: update, authenticated: true });
    if (!value || typeof value !== "object")
      throw new Error("Core returned an invalid updated storage lease.");
    const lease = value;
    if (typeof lease.deploymentId !== "string" || typeof lease.workspaceId !== "string" || !["CUSTOMER", "HOSTED", "DISABLED"].includes(String(lease.mode)) || typeof lease.revision !== "number" || typeof lease.issuedAt !== "string") {
      throw new Error("Core returned an invalid updated storage lease.");
    }
    return value;
  }
  async checkVersion() {
    const value = await this.request("/v1/agent/version", { method: "GET", authenticated: true });
    if (!value.updateAvailable)
      return void 0;
    if (!isReleaseMetadata(value.updateAvailable))
      throw new Error("Core returned invalid release metadata.");
    return value.updateAvailable;
  }
  async reportJob(event) {
    await this.request("/v1/jobs/events", { method: "POST", body: event, authenticated: true });
  }
  async pollControl() {
    const value = await this.request("/v1/agent/control/next", { method: "GET", authenticated: true });
    return value.control ?? void 0;
  }
  async reportControlResult(result) {
    await this.request("/v1/agent/control/result", { method: "POST", body: result, authenticated: true });
  }
  async reportHealth(payload) {
    await this.request("/v1/telemetry", { method: "POST", body: payload, authenticated: true });
  }
  async request(path3, options) {
    const requestId = randomUUID();
    const headers = {
      accept: "application/json",
      "x-request-id": requestId
    };
    if (options.body !== void 0)
      headers["content-type"] = "application/json";
    if (!options.authenticated && this.registrationSecret)
      headers["x-omega-registration-secret"] = this.registrationSecret;
    if (options.authenticated) {
      if (!this.accessToken)
        throw new CoreApiError({ code: "CORE_NOT_AUTHENTICATED", message: "Core authentication is required.", requestId, retryable: false, status: 401 });
      headers.authorization = `Bearer ${this.accessToken}`;
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs).unref();
      try {
        const response = await this.fetchImpl(`${this.apiUrl}${path3}`, {
          method: options.method,
          headers,
          body: options.body === void 0 ? void 0 : JSON.stringify(options.body),
          signal: controller.signal
        });
        const raw = await response.text();
        let parsed = void 0;
        if (raw) {
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = void 0;
          }
        }
        if (response.ok)
          return parsed;
        const error = parsed && typeof parsed === "object" ? parsed : {};
        const retryable = retryableStatus(response.status);
        if (retryable && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, backoff(attempt)));
          continue;
        }
        throw new CoreApiError({
          code: typeof error.code === "string" ? error.code : `CORE_HTTP_${response.status}`,
          message: typeof error.message === "string" ? error.message : "Core request failed.",
          requestId,
          retryable,
          status: response.status
        });
      } catch (error) {
        if (error instanceof CoreApiError)
          throw error;
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, backoff(attempt)));
          continue;
        }
        throw new CoreApiError({ code: "CORE_UNAVAILABLE", message: "Omega Core is temporarily unavailable.", requestId, retryable: true, status: 503 });
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error("Core request exhausted unexpectedly.");
  }
  assertCapabilities(value) {
    if (!value || typeof value.deploymentId !== "string" || typeof value.revision !== "number" || !value.features) {
      throw new Error("Core returned invalid capabilities.");
    }
    const allowed = ["antisystem", "media", "broadcast", "validator", "promotion", "bridge", "telegram", "whatsapp"];
    for (const key of Object.keys(value.features)) {
      if (!allowed.includes(key) || typeof value.features[key] !== "boolean") {
        throw new Error("Core returned invalid capability data.");
      }
    }
  }
};

// dist/core/CapabilityManager.js
var CapabilityManager = class {
  current;
  set(value) {
    this.current = value;
  }
  snapshot() {
    return this.current ? { ...this.current, features: { ...this.current.features } } : void 0;
  }
  allows(feature) {
    return this.current?.features[feature] === true;
  }
  require(feature) {
    if (!this.allows(feature)) {
      throw new Error(`Capability is not authorized: ${feature}`);
    }
  }
  isExpired(now = Date.now()) {
    const expiresAt = this.current?.expiresAt;
    return Boolean(expiresAt && Date.parse(expiresAt) <= now);
  }
};

// dist/core/Heartbeat.js
import { randomUUID as randomUUID2 } from "node:crypto";
var Heartbeat = class {
  core;
  identity;
  capabilities;
  intervalMs;
  sources;
  timer;
  running = false;
  current;
  announcedUpdateBuildId;
  constructor(core, identity, capabilities, intervalMs, sources = {}) {
    this.core = core;
    this.identity = identity;
    this.capabilities = capabilities;
    this.intervalMs = intervalMs;
    this.sources = sources;
  }
  snapshot() {
    return this.current;
  }
  start() {
    if (this.timer)
      return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
  }
  stop() {
    if (this.timer)
      clearInterval(this.timer);
    this.timer = void 0;
  }
  async tick() {
    if (this.running)
      return;
    this.running = true;
    const identity = this.identity();
    const request = {
      identity,
      runtimeStatus: "ONLINE",
      nodeVersion: process.version,
      platform: "pterodactyl",
      resource: this.sources.resource?.() ?? {
        rssBytes: process.memoryUsage().rss,
        heapUsedBytes: process.memoryUsage().heapUsed
      },
      capabilities: this.capabilities.snapshot() ?? {
        deploymentId: identity.deploymentId,
        features: {
          antisystem: false,
          media: false,
          broadcast: false,
          validator: false,
          promotion: false,
          bridge: false,
          telegram: false,
          whatsapp: false
        },
        revision: 0
      },
      sessions: this.sources.sessions?.() ?? [],
      jobs: this.sources.jobs?.() ?? [],
      forceJoin: this.sources.forceJoin?.() ?? { enabled: false, mode: "both" },
      requestId: randomUUID2(),
      sentAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    try {
      this.current = await this.core.heartbeat(request);
      if (this.current.capabilities)
        this.capabilities.set(this.current.capabilities);
      const release = this.current.updateAvailable;
      if (release && release.buildId !== this.announcedUpdateBuildId) {
        this.announcedUpdateBuildId = release.buildId;
        void Promise.resolve(this.sources.updateAvailable?.(release)).catch(() => {
        });
      }
    } catch {
    } finally {
      this.running = false;
    }
  }
};

// dist/config/config.js
import os from "node:os";
import path from "node:path";
function nonEmpty(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : void 0;
}
function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}
function loadClientConfig(env = process.env) {
  const workspaceRoot = path.resolve(env.OMEGA_WORKSPACE_ROOT?.trim() || path.join(process.cwd(), "workspace"));
  const installationFile = path.resolve(env.OMEGA_INSTALLATION_FILE?.trim() || path.join(workspaceRoot, "installation.json"));
  const platform = env.OMEGA_PLATFORM === "pterodactyl" || env.OMEGA_PLATFORM === "local" ? env.OMEGA_PLATFORM : "other";
  const logLevel = env.OMEGA_LOG_LEVEL === "error" || env.OMEGA_LOG_LEVEL === "warn" || env.OMEGA_LOG_LEVEL === "debug" ? env.OMEGA_LOG_LEVEL : "info";
  return {
    apiUrl: (env.OMEGA_API_URL?.trim() || "https://core.invalid").replace(/\/+$/u, ""),
    clientId: nonEmpty(env.OMEGA_CLIENT_ID),
    clientToken: nonEmpty(env.OMEGA_CLIENT_TOKEN),
    registrationSecret: nonEmpty(env.OMEGA_REGISTRATION_SECRET),
    workspaceId: nonEmpty(env.OMEGA_WORKSPACE_ID),
    deploymentId: nonEmpty(env.OMEGA_DEPLOYMENT_ID),
    installationFile,
    agentVersion: env.OMEGA_AGENT_VERSION?.trim() || "0.1.0",
    protocolVersion: boundedInt(env.OMEGA_PROTOCOL_VERSION, 1, 1, 100),
    platform,
    telegramBotToken: nonEmpty(env.TELEGRAM_BOT_TOKEN),
    redisUrl: nonEmpty(env.REDIS_URL),
    mongodbUri: nonEmpty(env.MONGO_URI) ?? nonEmpty(env.MONGODB_URI),
    workspaceRoot,
    heartbeatMs: boundedInt(env.OMEGA_HEARTBEAT_MS, 6e4, 15e3, 9e5),
    logLevel
  };
}
function validateClientConfig(config) {
  const errors = [];
  if (!/^https:\/\//iu.test(config.apiUrl) && config.apiUrl !== "https://core.invalid") {
    errors.push("OMEGA_API_URL must use HTTPS.");
  }
  if (!config.agentVersion)
    errors.push("OMEGA_AGENT_VERSION is required.");
  if (config.protocolVersion < 1)
    errors.push("OMEGA_PROTOCOL_VERSION is invalid.");
  if (config.workspaceRoot === os.homedir())
    errors.push("OMEGA_WORKSPACE_ROOT cannot be the home directory.");
  return errors;
}
function redactedConfigSummary(config) {
  return {
    apiUrl: config.apiUrl,
    clientId: config.clientId ? `${config.clientId.slice(0, 6)}\u2026` : void 0,
    registrationConfigured: Boolean(config.registrationSecret),
    workspaceId: config.workspaceId ? `${config.workspaceId.slice(0, 6)}\u2026` : void 0,
    deploymentId: config.deploymentId ? `${config.deploymentId.slice(0, 6)}\u2026` : void 0,
    agentVersion: config.agentVersion,
    protocolVersion: config.protocolVersion,
    platform: config.platform,
    telegramConfigured: Boolean(config.telegramBotToken),
    customerRedisConfigured: Boolean(config.redisUrl),
    customerMongoConfigured: Boolean(config.mongodbUri),
    workspaceRoot: config.workspaceRoot,
    heartbeatMs: config.heartbeatMs
  };
}

// dist/identity/identity-store.js
import { randomUUID as randomUUID3 } from "node:crypto";
import fs from "node:fs/promises";
import path2 from "node:path";
async function ensurePrivateDirectory(filePath) {
  await fs.mkdir(path2.dirname(filePath), { recursive: true, mode: 448 });
  try {
    await fs.chmod(path2.dirname(filePath), 448);
  } catch {
  }
}
async function loadIdentity(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const value = JSON.parse(raw);
    if (!value.clientId || !value.deploymentId || !value.workspaceId || !value.licenseId)
      return void 0;
    return value;
  } catch {
    return void 0;
  }
}
async function saveIdentity(filePath, identity) {
  await ensurePrivateDirectory(filePath);
  const temporary = `${filePath}.${process.pid}.${randomUUID3()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(identity, null, 2)}
`, { encoding: "utf8", mode: 384 });
  try {
    await fs.chmod(temporary, 384);
  } catch {
  }
  await fs.rename(temporary, filePath);
  try {
    await fs.chmod(filePath, 384);
  } catch {
  }
}
async function getOrCreateIdentity(filePath, agentVersion, protocolVersion, seed = {}) {
  const existing = await loadIdentity(filePath);
  if (existing)
    return existing;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const identity = {
    clientId: seed.clientId || randomUUID3(),
    deploymentId: seed.deploymentId || randomUUID3(),
    workspaceId: seed.workspaceId || randomUUID3(),
    licenseId: "PENDING_CORE_REGISTRATION",
    protocolVersion,
    agentVersion,
    createdAt: now,
    status: "OFFLINE"
  };
  await saveIdentity(filePath, identity);
  return identity;
}
async function updateIdentityStatus(filePath, identity, status, patch = {}) {
  const next = {
    ...identity,
    ...patch,
    status,
    lastSeenAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await saveIdentity(filePath, next);
  return next;
}

// dist/security/redaction.js
var SECRET_KEYS = /token|secret|password|authorization|credential|private.?key|auth|cookie|buffer|body/iu;
function redactValue(value, depth = 0) {
  if (depth > 4)
    return "[REDACTED_DEPTH]";
  if (typeof value === "string")
    return value.length > 180 ? `${value.slice(0, 180)}\u2026` : value;
  if (typeof value === "bigint")
    return "[REDACTED_BIGINT]";
  if (value instanceof Uint8Array || Buffer.isBuffer(value))
    return "[REDACTED_BINARY]";
  if (Array.isArray(value))
    return value.slice(0, 50).map((item) => redactValue(item, depth + 1));
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = SECRET_KEYS.test(key) ? "[REDACTED]" : redactValue(child, depth + 1);
    }
    return result;
  }
  return value;
}
function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/bearer\s+[a-z0-9._~-]+/igu, "Bearer [REDACTED]").replace(/(token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/igu, "$1=[REDACTED]").slice(0, 500);
}

// dist/observability/logger.js
var LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
var AgentLogger = class {
  level;
  constructor(level = "info") {
    this.level = level;
  }
  error(scope, message, context) {
    this.write("error", scope, message, context);
  }
  warn(scope, message, context) {
    this.write("warn", scope, message, context);
  }
  info(scope, message, context) {
    this.write("info", scope, message, context);
  }
  debug(scope, message, context) {
    this.write("debug", scope, message, context);
  }
  failure(scope, error, context) {
    this.write("warn", scope, safeErrorMessage(error), context);
  }
  write(level, scope, message, context) {
    if (LEVELS[level] > LEVELS[this.level])
      return;
    const at = (/* @__PURE__ */ new Date()).toISOString().slice(11, 19);
    const suffix = context === void 0 ? "" : ` ${JSON.stringify(redactValue(context))}`;
    const line = `[${at}] ${level.toUpperCase().padEnd(5)} ${scope.padEnd(10)} ${message}${suffix}`;
    if (level === "error")
      console.error(line);
    else if (level === "warn")
      console.warn(line);
    else
      console.log(line);
  }
};

// dist/runtime/LocalWorkloadAdapter.js
var PendingLocalWorkloadAdapter = class {
  listSessions() {
    return [];
  }
  listJobs() {
    return [];
  }
  forceJoinPolicy() {
    return { enabled: false, mode: "both" };
  }
  hasCapability() {
    return false;
  }
  drainJobEvents() {
    return [];
  }
  async executeControl(request) {
    return { requestId: request.requestId, jobId: request.jobId, deploymentId: request.deploymentId, workspaceId: request.workspaceId, status: "REJECTED", at: (/* @__PURE__ */ new Date()).toISOString(), error: { code: "WORKLOAD_NOT_ATTACHED", message: "Local workload adapter is not attached." } };
  }
  async start() {
  }
  async stop() {
  }
};

// dist/runtime/ClientRuntime.js
var ClientRuntime = class {
  config;
  logger;
  core;
  capabilities = new CapabilityManager();
  workload;
  heartbeat;
  jobEventTimer;
  controlTimer;
  storageTimer;
  storageLease;
  controlRunning = false;
  pendingJobEvents = [];
  identity;
  shuttingDown = false;
  onUpdateAvailable;
  constructor(options = {}) {
    this.config = loadClientConfig(options.env);
    this.onUpdateAvailable = options.onUpdateAvailable;
    this.workload = options.workload ?? new PendingLocalWorkloadAdapter();
    this.logger = new AgentLogger(this.config.logLevel);
    this.core = new CoreClient({ apiUrl: this.config.apiUrl, accessToken: this.config.clientToken, registrationSecret: this.config.registrationSecret, fetchImpl: options.fetchImpl });
  }
  async start() {
    const errors = validateClientConfig(this.config);
    this.logger.info("AGENT", "Starting Omega Client", redactedConfigSummary(this.config));
    if (errors.length > 0) {
      for (const error of errors)
        this.logger.error("CONFIG", error);
      throw new Error("Client configuration is invalid.");
    }
    this.identity = await getOrCreateIdentity(this.config.installationFile, this.config.agentVersion, PROTOCOL_VERSION, {
      clientId: this.config.clientId,
      deploymentId: this.config.deploymentId,
      workspaceId: this.config.workspaceId
    });
    this.core.setAccessToken(this.config.clientToken ?? this.identity.clientToken);
    const localFeatures = ["antisystem", "media", "broadcast", "validator", "promotion", "bridge", "telegram", "whatsapp"];
    this.capabilities.set({
      deploymentId: this.identity.deploymentId,
      features: Object.fromEntries(localFeatures.map((feature) => [feature, this.workload.hasCapability(feature)])),
      revision: 0
    });
    this.logger.info("IDENTITY", "Local deployment identity ready", { deploymentId: this.identity.deploymentId, workspaceId: this.identity.workspaceId });
    if (this.config.apiUrl !== "https://core.invalid") {
      await this.registerWithCore();
    } else {
      this.logger.warn("CORE", "Core API is not configured; local setup is required before online mode.");
    }
    await this.workload.start();
    this.heartbeat = new Heartbeat(this.core, () => this.identity, this.capabilities, this.config.heartbeatMs, {
      sessions: () => this.workload.listSessions(),
      jobs: () => this.workload.listJobs(),
      forceJoin: () => this.workload.forceJoinPolicy(),
      resource: () => ({
        rssBytes: process.memoryUsage().rss,
        heapUsedBytes: process.memoryUsage().heapUsed,
        activeWorkers: 0
      }),
      updateAvailable: (release) => this.onUpdateAvailable?.(release)
    });
    this.heartbeat.start();
    void this.refreshStorageLease();
    this.storageTimer = setInterval(() => void this.refreshStorageLease(), Math.max(15e3, this.config.heartbeatMs));
    this.storageTimer.unref?.();
    this.jobEventTimer = setInterval(() => void this.flushJobEvents(), Math.max(15e3, this.config.heartbeatMs));
    this.jobEventTimer.unref?.();
    this.controlTimer = setInterval(() => void this.pollControl(), Math.max(5e3, Math.min(15e3, this.config.heartbeatMs)));
    this.controlTimer.unref?.();
    void this.flushJobEvents();
    void this.pollControl();
    this.logger.info("AGENT", "Client foundation online", { status: "ONLINE", workload: "local-adapter-attached" });
  }
  async stop() {
    if (this.shuttingDown)
      return;
    this.shuttingDown = true;
    this.heartbeat?.stop();
    if (this.jobEventTimer)
      clearInterval(this.jobEventTimer);
    if (this.controlTimer)
      clearInterval(this.controlTimer);
    if (this.storageTimer)
      clearInterval(this.storageTimer);
    this.jobEventTimer = void 0;
    this.controlTimer = void 0;
    this.storageTimer = void 0;
    await this.workload.stop();
    if (this.identity) {
      this.identity = await updateIdentityStatus(this.config.installationFile, this.identity, "OFFLINE");
    }
    this.logger.info("AGENT", "Client stopped cleanly");
  }
  requireCapability(feature) {
    this.capabilities.require(feature);
  }
  async updateStorageLease(update) {
    if (!this.identity)
      throw new Error("Client is not started.");
    const lease = await this.core.updateStorageLease(update);
    if (lease.deploymentId !== this.identity.deploymentId || lease.workspaceId !== this.identity.workspaceId)
      throw new Error("Updated storage lease ownership mismatch.");
    if (this.workload.applyStorageLease)
      await this.workload.applyStorageLease(lease);
    this.storageLease = lease;
    this.logger.info("STORAGE", "Storage lease hot-applied", { mode: lease.mode, revision: lease.revision });
    return lease;
  }
  async rotateCoreCredential() {
    if (!this.identity)
      throw new Error("Client is not started.");
    const result = await this.core.rotateCredential();
    await saveIdentity(this.config.installationFile, { ...this.identity, clientToken: result.accessToken });
    this.logger.info("CORE", "Credential rotated", { keyId: result.keyId, previousExpiresAt: result.previousExpiresAt });
    return { keyId: result.keyId, previousExpiresAt: result.previousExpiresAt };
  }
  getIdentity() {
    return this.identity;
  }
  getConfig() {
    return { ...this.config };
  }
  getStorageLease() {
    return this.storageLease ? { ...this.storageLease } : void 0;
  }
  async refreshStorageLease() {
    if (!this.identity || this.config.apiUrl === "https://core.invalid")
      return;
    try {
      const lease = await this.core.getStorageLease();
      if (lease.deploymentId !== this.identity.deploymentId || lease.workspaceId !== this.identity.workspaceId)
        throw new Error("Storage lease ownership mismatch.");
      if (!this.storageLease || this.storageLease.revision !== lease.revision || this.storageLease.mode !== lease.mode) {
        this.logger.info("STORAGE", "Storage lease updated", { mode: lease.mode, revision: lease.revision, expiresAt: lease.expiresAt });
        if (this.workload.applyStorageLease) {
          await this.workload.applyStorageLease(lease);
        } else if (lease.mode === "HOSTED") {
          this.logger.warn("STORAGE", "Hosted lease received but local workload has no data-plane rebind implementation; retaining current storage", { revision: lease.revision });
          return;
        }
      }
      this.storageLease = lease;
    } catch (error) {
      this.logger.warn("STORAGE", "Storage lease unavailable; local workload remains unchanged", { error: safeErrorMessage(error) });
    }
  }
  async pollControl() {
    if (this.controlRunning || !this.identity || this.config.apiUrl === "https://core.invalid" || !this.workload.executeControl)
      return;
    this.controlRunning = true;
    try {
      const request = await this.core.pollControl();
      if (!request)
        return;
      let result;
      if (request.deploymentId !== this.identity.deploymentId || request.workspaceId !== this.identity.workspaceId) {
        result = { requestId: request.requestId, jobId: request.jobId, deploymentId: request.deploymentId, workspaceId: request.workspaceId, status: "REJECTED", at: (/* @__PURE__ */ new Date()).toISOString(), error: { code: "CONTROL_OWNERSHIP_MISMATCH", message: "Control request is outside the active installation scope." } };
      } else {
        result = await this.workload.executeControl(request);
      }
      await this.core.reportControlResult(result);
    } catch {
    } finally {
      this.controlRunning = false;
    }
  }
  async flushJobEvents() {
    const fresh = this.workload.drainJobEvents?.() ?? [];
    for (const event of fresh.slice(0, 50)) {
      if (this.pendingJobEvents.length >= 100)
        this.pendingJobEvents.shift();
      this.pendingJobEvents.push(event);
    }
    if (this.pendingJobEvents.length === 0 || this.config.apiUrl === "https://core.invalid")
      return;
    const batch = this.pendingJobEvents.splice(0, Math.min(20, this.pendingJobEvents.length));
    const results = await Promise.allSettled(batch.map((event) => this.core.reportJob(event)));
    const failed = batch.filter((_, index) => results[index]?.status === "rejected");
    if (failed.length > 0)
      this.pendingJobEvents.unshift(...failed.slice(-100));
  }
  async registerWithCore() {
    if (!this.identity)
      throw new Error("Identity must be initialized before registration.");
    try {
      const result = await this.core.register({
        clientId: this.identity.clientId,
        deploymentId: this.identity.deploymentId,
        workspaceId: this.identity.workspaceId,
        agentVersion: this.identity.agentVersion,
        protocolVersion: this.identity.protocolVersion,
        capabilities: ["antisystem", "media", "broadcast", "validator", "promotion", "bridge", "telegram", "whatsapp"],
        requestId: cryptoRandomId()
      });
      this.core.setAccessToken(result.accessToken);
      this.capabilities.set(result.capabilities);
      this.identity = await updateIdentityStatus(this.config.installationFile, this.identity, "ACTIVE", {
        licenseId: result.identity.licenseId,
        deploymentId: result.identity.deploymentId,
        workspaceId: result.identity.workspaceId
      });
      await saveIdentity(this.config.installationFile, { ...this.identity, clientToken: result.accessToken });
      this.logger.info("CORE", "Connected and deployment registered", { deploymentId: this.identity.deploymentId });
    } catch (error) {
      this.logger.warn("CORE", `Registration unavailable: ${safeErrorMessage(error)}`);
    }
  }
};
function cryptoRandomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// dist/runtime/CommandAdapter.js
var CommandAdapter = class {
  workspaceId;
  deploymentId;
  source;
  constructor(workspaceId, deploymentId, source) {
    this.workspaceId = workspaceId;
    this.deploymentId = deploymentId;
    this.source = source;
  }
  async execute(request) {
    const base = { requestId: request.requestId, jobId: request.jobId, deploymentId: request.deploymentId, workspaceId: request.workspaceId };
    if (request.deploymentId !== this.deploymentId || request.workspaceId !== this.workspaceId) {
      return { ...base, status: "REJECTED", at: (/* @__PURE__ */ new Date()).toISOString(), error: { code: "CONTROL_OWNERSHIP_MISMATCH", message: "Control request is outside the active installation scope." } };
    }
    if (!this.source.executeControl) {
      return { ...base, status: "REJECTED", at: (/* @__PURE__ */ new Date()).toISOString(), error: { code: "CONTROL_UNSUPPORTED", message: "This local workload operation is not attached." } };
    }
    return this.source.executeControl(request);
  }
};

// dist/runtime/ForceJoinAdapter.js
var ForceJoinAdapter = class {
  source;
  constructor(source) {
    this.source = source;
  }
  policy() {
    return { ...this.source.forceJoinPolicy() };
  }
};

// dist/runtime/adapter-scope.js
var SESSION_STATUSES = /* @__PURE__ */ new Set(["PAIRING", "ACTIVE", "RECONNECTING", "DEGRADED", "LOGGED_OUT", "PURGING"]);
var JOB_STATUSES = /* @__PURE__ */ new Set(["QUEUED", "RUNNING", "PAUSED", "COMPLETED", "FAILED", "CANCELLED", "RETRY_AT"]);
function scopeError(kind, id) {
  return new Error(`${kind} ${id} is outside the active installation/workspace scope.`);
}
function safeCode(code) {
  if (!code)
    return void 0;
  const normalized = code.replace(/[^A-Za-z0-9_.:-]+/gu, "_").slice(0, 64);
  return normalized || void 0;
}
function normalizeSessionStatus(value) {
  const normalized = value.toUpperCase();
  if (SESSION_STATUSES.has(normalized))
    return normalized;
  if (normalized === "CONNECTING" || normalized === "DISCONNECTED" || normalized === "FAILED" || normalized === "FROZEN")
    return "DEGRADED";
  return "DEGRADED";
}
function normalizeJobStatus(value) {
  const normalized = value.toUpperCase();
  if (JOB_STATUSES.has(normalized))
    return normalized;
  if (normalized === "STARTING" || normalized === "PROCESSING" || normalized === "RUNNING")
    return "RUNNING";
  if (normalized === "STOPPING" || normalized === "PAUSING" || normalized === "PAUSED")
    return "PAUSED";
  if (normalized === "RATE_LIMITED" || normalized === "SESSION_UNAVAILABLE")
    return "RETRY_AT";
  if (normalized === "STOPPED")
    return "CANCELLED";
  return "FAILED";
}
function mapSession(session) {
  return {
    sessionId: session.sessionId,
    workspaceId: session.workspaceId,
    status: normalizeSessionStatus(session.status),
    generation: Number.isInteger(session.generation) && session.generation >= 0 ? session.generation : 0,
    ...session.connectedAt ? { connectedAt: session.connectedAt } : {},
    ...safeCode(session.lastErrorCode) ? { lastErrorCode: safeCode(session.lastErrorCode) } : {}
  };
}
function mapJob(job) {
  return {
    deploymentId: job.deploymentId,
    workspaceId: job.workspaceId,
    ...job.sessionId ? { sessionId: job.sessionId } : {},
    jobId: job.jobId,
    type: job.type.slice(0, 64),
    status: normalizeJobStatus(job.status),
    ...job.generation === void 0 ? {} : { generation: job.generation },
    owner: job.owner.slice(0, 96),
    ...job.startedAt ? { startedAt: job.startedAt } : {},
    updatedAt: job.updatedAt,
    ...job.progress ? { progress: { current: Math.max(0, job.progress.current), ...job.progress.total === void 0 ? {} : { total: Math.max(0, job.progress.total) }, ...job.progress.label ? { label: job.progress.label.slice(0, 120) } : {} } } : {},
    ...job.errorCode || job.errorMessage ? { error: { code: safeCode(job.errorCode) ?? "LOCAL_JOB_FAILED", message: (job.errorMessage ?? "Local job failed.").slice(0, 240) } } : {}
  };
}
function assertSessionScope(workspaceId, session) {
  if (session.workspaceId !== workspaceId)
    throw scopeError("Session", session.sessionId);
}
function assertJobScope(workspaceId, deploymentId, job) {
  if (job.deploymentId !== deploymentId || job.workspaceId !== workspaceId)
    throw scopeError("Job", job.jobId);
}

// dist/runtime/JobAdapter.js
var JobAdapter = class {
  workspaceId;
  deploymentId;
  source;
  constructor(workspaceId, deploymentId, source) {
    this.workspaceId = workspaceId;
    this.deploymentId = deploymentId;
    this.source = source;
  }
  listJobs() {
    return this.source.listJobs().map((job) => {
      assertJobScope(this.workspaceId, this.deploymentId, job);
      return mapJob(job);
    });
  }
  drainJobEvents() {
    return [...this.source.drainJobEvents?.() ?? []].slice(0, 50);
  }
};

// dist/runtime/SessionAdapter.js
var SessionAdapter = class {
  workspaceId;
  source;
  constructor(workspaceId, source) {
    this.workspaceId = workspaceId;
    this.source = source;
  }
  listSessions() {
    return this.source.listSessions().map((session) => {
      assertSessionScope(this.workspaceId, session);
      return mapSession(session);
    });
  }
};

// dist/runtime/MonolithWorkloadAdapter.js
var MonolithWorkloadAdapter = class {
  workspaceId;
  deploymentId;
  source;
  sessions;
  jobs;
  forceJoin;
  commands;
  started = false;
  constructor(workspaceId, deploymentId, source) {
    this.workspaceId = workspaceId;
    this.deploymentId = deploymentId;
    this.source = source;
    if (!workspaceId.trim() || !deploymentId.trim())
      throw new Error("Workload adapter requires a workspace and deployment scope.");
    this.sessions = new SessionAdapter(workspaceId, source);
    this.jobs = new JobAdapter(workspaceId, deploymentId, source);
    this.forceJoin = new ForceJoinAdapter(source);
    this.commands = new CommandAdapter(workspaceId, deploymentId, source);
  }
  listSessions() {
    return this.sessions.listSessions();
  }
  listJobs() {
    return this.jobs.listJobs();
  }
  forceJoinPolicy() {
    return this.forceJoin.policy();
  }
  hasCapability(feature) {
    return this.source.hasCapability(feature);
  }
  drainJobEvents() {
    return this.jobs.drainJobEvents();
  }
  async executeControl(request) {
    return this.commands.execute(request);
  }
  async start() {
    if (this.started)
      return;
    this.started = true;
    await this.source.start?.();
  }
  async stop() {
    if (!this.started)
      return;
    this.started = false;
    await this.source.stop?.();
  }
  async applyStorageLease(lease) {
    if (!this.source.applyStorageLease)
      throw new Error("Local workload has no storage rebind implementation.");
    await this.source.applyStorageLease(lease);
  }
};
export {
  ClientRuntime,
  MonolithWorkloadAdapter
};
