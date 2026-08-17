# Omega Customer Bot 1.2.11

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

The setup then asks for a WhatsApp number. Enter the full number with country code and no spaces, for example `2348012345678`. Pairing has a one-minute countdown. A successful session is preserved across restarts. Failed, expired, revoked, or abandoned pairing attempts are removed immediately, so stale Pair or Resume buttons are not retained.

On later restarts, completed Telegram setup, owner identity, and existing WhatsApp sessions are reused. Only missing configuration is requested. The customer owner can use the Telegram **Restart Customer Bot** button or `/restart`; the panel process manager will bring the bot back with saved sessions and settings. Stable runtime **1.2.7** also recovers stale same-container ownership after an unresponsive previous process and reopens setup when Telegram is configured but `TELEGRAM_OWNER_ID` is missing. If the panel still reports a live owner, press **Stop**, wait for the old process to exit, and then press **Start** once.

## Optional Redis

Redis is optional for ordinary WhatsApp and Telegram commands. Redis-backed queues and bulk workers show a degraded status when Redis is unavailable instead of preventing normal bot startup.

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

The uploaded `index.js` is the bootstrap key. With automatic updates enabled, restarting the server checks the stable GitHub manifest, verifies SHA-256 hashes, stages the new runtime safely, and keeps the previous working release if an update fails. Customers do not need to download another file for future stable updates. Keep the original bootstrap `index.js`; restart the server and it will fetch, verify, install, and activate the newest runtime automatically.

For resource recommendations and troubleshooting, use the accompanying `CUSTOMER_QUICKSTART.md` guide supplied by the operator.

## Useful Telegram controls

The parent operator can use `/getid` to provide an owner ID and `/broadcast <message>` to send a controlled message to active customer owners. Customer owners can use `/restart` or the main-menu restart button. Public release notices may include operator-configured URL buttons; those buttons are public links only and are not admin controls.

## Security boundary

The customer release excludes TypeScript source, source maps, panel credentials, VPS private keys, and operator database passwords. Compiled JavaScript must still be treated as executable software rather than as a cryptographic secret; never embed credentials in environment files committed to a repository.

## Parent Force Join verification

Customer deployments keep using their own Telegram bot token. When the operator allocates Force Join, the customer runtime sends the signed-in Telegram user ID through the authenticated Core connection; the parent Core service checks membership using the operator bot in the required channel or group. The customer bot token is not used to inspect the operator’s channel.

Users who have not joined receive a Join button and an **I Joined** button. Access remains restricted until the parent verification succeeds. The parent bot must be an administrator in the required channel or group for membership checks to work.
