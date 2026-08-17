import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

process.env.NODE_NO_WARNINGS ??= '1';
process.noDeprecation = true;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(ROOT, '.omega-runtime');
const CURRENT_DIR = path.join(STATE_DIR, 'current');
const BACKUP_DIR = path.join(STATE_DIR, 'backup');
const STAGE_DIR = path.join(STATE_DIR, '.stage');
const REPO = process.env.OMEGA_UPDATE_REPO?.trim() || 'pappy999666-dotcom/omega-customer-distribution';
const CHANNEL = process.env.OMEGA_UPDATE_CHANNEL?.trim() || 'stable';
const MANIFEST_URL = process.env.OMEGA_UPDATE_MANIFEST_URL?.trim()
  || `https://raw.githubusercontent.com/${REPO}/main/releases/${CHANNEL}/manifest.json`;
const AUTO_UPDATE = !/^(0|false|no|off)$/iu.test(process.env.OMEGA_AUTO_UPDATE ?? 'true');
const FETCH_TIMEOUT_MS = 45_000;

const ANSI = { reset: '\x1b[0m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', dim: '\x1b[2m' };
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let spinnerTimer;
let spinnerFrame = 0;
function clearLiveLine() { if (process.stdout.isTTY) process.stdout.write('\r\x1b[2K'); }
function status(message) { clearLiveLine(); process.stdout.write(`${ANSI.green}✓${ANSI.reset} ${message}\n`); }
function warn(message) { clearLiveLine(); process.stdout.write(`${ANSI.yellow}!${ANSI.reset} ${message}\n`); }
function startLive(message) {
  let elapsed = 0;
  const draw = () => {
    const frame = SPINNER[spinnerFrame++ % SPINNER.length];
    const dots = '.'.repeat((spinnerFrame % 4) + 1);
    const line = `${ANSI.cyan}${frame}${ANSI.reset} ${message}${dots}${ANSI.dim} ${elapsed}s${ANSI.reset}`;
    if (process.stdout.isTTY) process.stdout.write(`\r\x1b[2K${line}`);
    else process.stdout.write(`${line}\n`);
    elapsed += 1;
  };
  draw();
  spinnerTimer = setInterval(draw, 1_200);
  spinnerTimer.unref?.();
  return () => { if (spinnerTimer) clearInterval(spinnerTimer); spinnerTimer = undefined; clearLiveLine(); status(message + ' complete'); };
}
function critical(message, error) {
  process.stderr.write(`[OMEGA] CRITICAL: ${message}${error ? ` — ${error.message || error}` : ''}\n`);
}
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }
function safeRelative(file) {
  const value = String(file || '');
  if (!value || value.startsWith('/') || value.includes('\\') || value.split('/').includes('..')) throw new Error(`Invalid release path: ${value}`);
  return value;
}
async function fetchBytes(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'omega-customer-bootstrap' } });
    if (!response.ok) throw new Error(`HTTP ${response.status} from update server`);
    return Buffer.from(await response.arrayBuffer());
  } finally { clearTimeout(timer); }
}
async function fetchJson(url) { return JSON.parse((await fetchBytes(`${url}${url.includes('?') ? '&' : '?'}omega=${Date.now()}`)).toString('utf8')); }
function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function hashFile(file) { return sha256(fs.readFileSync(file)); }
function runNpmInstall(cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], {
      cwd,
      env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false', npm_config_loglevel: 'error' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`npm install failed (${code}): ${stderr.slice(-500)}`)));
  });
}
async function stageRelease(manifest) {
  if (!manifest || typeof manifest.version !== 'string' || !Array.isArray(manifest.files)) throw new Error('Invalid update manifest');
  fs.rmSync(STAGE_DIR, { recursive: true, force: true });
  ensureDir(STAGE_DIR);
  const stopDownload = startLive(`downloading and verifying release ${manifest.version}`);
  try {
    for (const entry of manifest.files) {
    const relative = safeRelative(entry.path);
    const data = await fetchBytes(`https://raw.githubusercontent.com/${REPO}/main/releases/${CHANNEL}/${relative}?omega=${encodeURIComponent(manifest.version)}`);
    if (sha256(data) !== entry.sha256) throw new Error(`Hash mismatch for ${relative}`);
    const destination = path.join(STAGE_DIR, relative);
    ensureDir(path.dirname(destination));
      fs.writeFileSync(destination, data, { mode: relative.endsWith('.json') || relative.endsWith('.js') || relative.endsWith('.mjs') ? 0o600 : 0o640 });
    }
  } finally { stopDownload(); }
  if (!fs.existsSync(path.join(STAGE_DIR, 'package.json')) || !fs.existsSync(path.join(STAGE_DIR, 'runtime.mjs'))) throw new Error('Release is missing required runtime files');
  const stopInstall = startLive('installing required runtime packages safely');
  try { await runNpmInstall(STAGE_DIR); } finally { stopInstall(); }
  return manifest.version;
}
function promote(version) {
  fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
  if (fs.existsSync(CURRENT_DIR)) fs.renameSync(CURRENT_DIR, BACKUP_DIR);
  fs.renameSync(STAGE_DIR, CURRENT_DIR);
  fs.writeFileSync(path.join(STATE_DIR, 'state.json'), JSON.stringify({ version, updatedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
  fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
}
async function ensureCurrent() {
  ensureDir(STATE_DIR);
  let manifest;
  const stopCheck = startLive(AUTO_UPDATE ? 'checking for a verified Omega update' : 'checking the installed Omega runtime');
  try { manifest = AUTO_UPDATE ? await fetchJson(MANIFEST_URL) : null; }
  catch (error) {
    stopCheck();
    if (fs.existsSync(path.join(CURRENT_DIR, 'runtime.mjs'))) { warn(`update check unavailable; using installed release`); return; }
    throw error;
  }
  stopCheck();
  const statePath = path.join(STATE_DIR, 'state.json');
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
  const needsUpdate = Boolean(manifest && (state.version !== manifest.version || !fs.existsSync(path.join(CURRENT_DIR, 'node_modules'))));
  if (!needsUpdate) { status('installed customer runtime is already current'); return; }
  status(`updating customer runtime to ${manifest.version}`);
  try {
    await stageRelease(manifest);
    promote(manifest.version);
    status(`runtime ${manifest.version} ready`);
  } catch (error) {
    fs.rmSync(STAGE_DIR, { recursive: true, force: true });
    if (fs.existsSync(path.join(CURRENT_DIR, 'runtime.mjs'))) { warn(`update rejected; previous release retained (${error.message})`); return; }
    throw error;
  }
}
async function main() {
  process.env.NODE_NO_WARNINGS ??= '1';
  process.env.OMEGA_CUSTOMER_RUNTIME ??= 'true';
  process.env.OMEGA_PLATFORM ??= 'pterodactyl';
  process.env.OMEGA_RUNTIME_ROLE ??= 'customer';
  await ensureCurrent();
  status('customer runtime verified; handing over to live setup');
  const runtime = pathToFileURL(path.join(CURRENT_DIR, 'runtime.mjs')).href;
  await import(`${runtime}?boot=${Date.now()}`);
}
main().catch((error) => { critical('customer runtime could not start', error); process.exitCode = 1; });
