# Omega Customer Bot 1.2.24

This repository publishes the source-protected Omega customer runtime. Customers deploy with one file: the root `index.js` bootstrap. It downloads the verified stable runtime, installs production dependencies, preserves the previous working release when an update fails, and starts the local bot.

## Deploy in a Node.js panel

Download [`index.js`](./index.js) and upload it to the root of a Node.js server in your panel. Do not rename it. Use Node.js 22 or newer and set the startup command to:

```bash
node index.js
```

Start the server and wait for the live setup display. The bootstrap downloads the protected stable runtime, verifies the release hashes, installs production dependencies, and starts the bot. You do not need a Pterodactyl API token or a source-code archive.

## First-run setup

The setup asks for a Telegram token first. To create one, open Telegram, search for **@BotFather**, send `/newbot`, follow the instructions, and paste the resulting token into the panel console. Type `skip` if Telegram control is not required.

If Telegram is enabled, the setup asks for your owner chat ID. Open the parent Omega bot and send `/getid` (or `/id`), then paste the numeric **Your user ID** value into the panel console. This makes you the owner of this customer deployment only; it does not transfer the parent admin panel or operator identity.

The setup then asks for the personal WhatsApp number that should control the customer bot. Enter the controller number, not the WhatsApp number being paired as the bot account. That number is stored as the session owner, so normal WhatsApp commands work immediately while other users remain protected by the sudo gate. If you skip it, allocate the number later through the customer Telegram bot’s Sudo menu.

The setup asks for a short WhatsApp session name first, then the WhatsApp number. Use names such as `Main`, `Work`, or `Store` so multiple connections remain easy to identify. Enter the full number with country code and no spaces, for example `2348012345678`. Pairing has a one-minute countdown. A successful session is preserved across restarts. Failed, expired, revoked, or abandoned pairing attempts are removed immediately, so stale Pair or Resume buttons are not retained.

On later restarts, completed Telegram setup, owner identity, and existing WhatsApp sessions are reused. Only missing configuration is requested. The customer owner can use the Telegram **Restart Customer Bot** button or `/restart` when intentionally restarting; Redis changes and parent policy/runtime updates apply automatically without requiring that button. Session controls include **Set Name**, **Pair/Resume**, and **Purge**. Purge closes the socket and removes the selected session’s authentication and metadata without touching other sessions. The runtime reports a session as ready only after its WhatsApp socket is operational, so a stale durable ACTIVE record is never presented as usable. If the panel still reports a live owner, press **Stop**, wait for the old process to exit, and then press **Start** once.

## Optional Redis

Redis is optional for ordinary WhatsApp and Telegram commands. Redis-backed queues and bulk workers show a degraded status when Redis is unavailable instead of preventing normal bot startup. From Telegram **Settings → Redis Storage**, paste either a `redis://…` URL or the full `redis-cli -u redis://…` command. The runtime validates the endpoint, persists it through the authenticated parent Core, hot-rebinds workers immediately, and does not require a restart. **Clear Redis** stops only queue workers and leaves ordinary commands available.

A normal Redis URL is accepted:

```dotenv
REDIS_URL=redis://default:password@host:6379
```

You can also paste a provider command directly:

```text
redis-cli -u redis://default:password@host:15606
```

Do not publish Redis passwords, SSH keys, MongoDB credentials, Core tokens, or panel tokens in this repository or in screenshots.

## Join Manager and AutoJoin

The Telegram Link Join Manager now treats temporary WhatsApp, network, and rate-limit failures as retryable. Pressing Start reopens retryable Active links and tells you clearly when no eligible work remains; proven invalid or revoked links stay retired.

The Join Manager panel includes AutoJoin On/Off controls. WhatsApp also supports:

```text
.autojoin on
.autojoin off
.autojoin status
```

When enabled for a session, valid WhatsApp invite links seen in ordinary messages are queued in the background. Normal commands remain responsive, duplicate links are coalesced, and groups the session already belongs to are skipped automatically.

## VPS deployment

On a VPS, upload `index.js` to an empty application directory and run:

```bash
node index.js
```

A process manager such as PM2 may be used to keep the process online. Keep the terminal environment private and allow outbound HTTPS access so the bootstrap can check the stable release channel after restarts.

## Parent synchronization

When the operator Core is configured, the customer deployment enrolls with an authenticated installation token. Parent Force Join policies are checked through the parent bot even when the customer uses a separate Telegram bot token. Parent broadcasts are delivered to the owner of each active customer deployment, and customer ideas submitted through **Send Idea** are synchronized into the parent admin inbox. A temporary Core outage does not expose credentials; local ordinary commands remain the customer runtime’s responsibility.

## Automatic updates

The uploaded `index.js` is the bootstrap key. With automatic updates enabled, the customer heartbeat receives the release signal from the parent Core, compares it with the packaged runtime version, waits briefly for active work to settle, and hands a graceful restart to the panel supervisor only when a newer build exists. The bootstrap then checks the stable GitHub manifest, verifies SHA-256 hashes, stages the new runtime safely, installs changed production dependencies, and keeps the previous working release if an update fails. Customers do not need to download another file for future stable updates. Keep the original bootstrap `index.js`; new commands, dependency changes, and parent policy updates are pulled automatically.

For resource recommendations and troubleshooting, use the accompanying `CUSTOMER_QUICKSTART.md` guide supplied by the operator.

## Useful Telegram controls

The parent operator can use `/getid` to provide an owner ID and `/broadcast <message>` to send a controlled message to active customer owners. Customer owners can use `/restart` or the main-menu restart button. Public release notices may include operator-configured URL buttons; those buttons are public links only and are not admin controls.

## Security boundary

The customer release excludes TypeScript source, source maps, panel credentials, VPS private keys, and operator database passwords. Compiled JavaScript must still be treated as executable software rather than as a cryptographic secret; never embed credentials in environment files committed to a repository.

## Link previews

Every message containing a URL is routed through the shared preview pipeline. The current target’s real WhatsApp or URL thumbnail always outranks stale or previously rendered card bytes. Incomplete, untrusted, or fallback previews are refreshed from the actual URL. If the source has no usable image, the message remains thumbnail-less; Omega does not generate a fake replacement thumbnail.

## Parent Force Join verification

Customer deployments keep using their own Telegram bot token. When the operator allocates Force Join, the customer runtime sends the signed-in Telegram user ID through the authenticated Core connection; the parent Core service checks membership using the operator bot in the required channel or group. The customer bot token is not used to inspect the operator’s channel.

Users who have not joined receive a Join button and an **I Joined** button, and access is restricted when the parent verifier returns an explicit non-member result. If the parent verifier is temporarily unavailable, the customer shows the configured targets and keeps ordinary commands available rather than locking out members; verification resumes automatically. The parent bot must be an administrator in the required channel or group for membership checks to work.
