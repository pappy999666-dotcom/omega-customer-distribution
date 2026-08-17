# Omega Customer Bot 1.2.0

This repository publishes the source-protected Omega customer runtime. Customers deploy with one file: the root `index.js` bootstrap. It downloads the verified stable runtime, installs production dependencies, preserves the previous working release when an update fails, and starts the local bot.

## Deploy in a Node.js panel

Download [`index.js`](./index.js) and upload it to the root of a Node.js server in your panel. Do not rename it. Use Node.js 22 or newer and set the startup command to:

```bash
node index.js
```

Start the server and wait for the live setup display. The bootstrap downloads the protected stable runtime, verifies the release hashes, installs production dependencies, and starts the bot. You do not need a Pterodactyl API token or a source-code archive.

## First-run setup

The setup asks for a Telegram token first. To create one, open Telegram, search for **@BotFather**, send `/newbot`, follow the instructions, and paste the resulting token into the panel console. Type `skip` if Telegram control is not required.

The setup then asks for a WhatsApp number. Enter the full number with country code and no spaces, for example `2348012345678`. Pairing has a one-minute countdown. A successful session is preserved across restarts. Failed, expired, revoked, or abandoned pairing attempts are removed immediately, so stale Pair or Resume buttons are not retained.

On later restarts, completed Telegram setup and existing WhatsApp sessions are reused. Only missing configuration is requested.

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

## VPS deployment

On a VPS, upload `index.js` to an empty application directory and run:

```bash
node index.js
```

A process manager such as PM2 may be used to keep the process online. Keep the terminal environment private and allow outbound HTTPS access so the bootstrap can check the stable release channel after restarts.

## Automatic updates

The uploaded `index.js` is the bootstrap key. With automatic updates enabled, restarting the server checks the stable GitHub manifest, verifies SHA-256 hashes, stages the new runtime safely, and keeps the previous working release if an update fails. Customers normally do not need to download another file for future stable updates.

For resource recommendations and troubleshooting, use the accompanying `CUSTOMER_QUICKSTART.md` guide supplied by the operator.

## Security boundary

The customer release excludes TypeScript source, source maps, panel credentials, VPS private keys, and operator database passwords. Compiled JavaScript must still be treated as executable software rather than as a cryptographic secret; never embed credentials in environment files committed to a repository.
