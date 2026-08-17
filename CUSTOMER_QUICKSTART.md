# Omega Customer Runtime — v1.2.26

This guide is for customers deploying the source-protected Omega runtime on a compatible Node.js panel or VPS. The deployment uses one bootstrap file, `index.js`. The bootstrap downloads the verified runtime from the stable release channel, installs production dependencies, and starts the bot locally. Customer workloads, WhatsApp sessions, media files, and settings remain on the customer’s own server.

> **Important:** Keep the original `index.js`. Future Omega releases are downloaded and verified automatically; you do not need a new bootstrap file for every update.

## Requirements

| Item | Requirement |
| --- | --- |
| Runtime | Node.js 22 or newer |
| Panel | A hosted Node.js panel with outbound HTTPS access |
| Startup file | `index.js` in the application root |
| Startup command | `node index.js` |
| Storage | Persistent disk for sessions, settings, and downloaded media |
| Redis | Optional; recommended for queue-heavy or bulk workloads |
| MongoDB | Optional unless your chosen configuration enables a Mongo-backed feature |

The customer runtime does **not** require a hosting-provider API token. Do not upload the private Omega monorepo, TypeScript source, source maps, VPS keys, Redis passwords, MongoDB credentials, or Core credentials.

## Choose a panel

The easiest route is a hosted Node.js panel that provides persistent disk, a live console, file upload, a startup command, and an automatic restart option. The exact labels vary between providers, but the Omega deployment always uses the same four values: **Node.js 22 or newer**, file **`index.js`**, startup command **`node index.js`**, and persistent application storage.

| Option | Best use | What to expect |
| --- | --- | --- |
| **Spaceify** | The panel selected for this deployment guide | Open the client, create a Node.js server, upload `index.js`, set `node index.js`, and start it. The public client is login/CAPTCHA gated, so menu names may differ after sign-in. Confirm that the selected server has persistent storage and Node.js 22 or newer. |
| **Zampto Hosting** | A documented free/freemium panel route | Create Server → choose account resources → allocate RAM, disk, CPU, backups, and port → choose **NodeJS** → choose a node → create. When ready, open **Control Panel → File Manager**, upload `index.js`, use **Console**, and set the startup command to `node index.js`. Zampto’s public guide says node selection cannot later be changed and that creation is queued. [1] |
| **HidenCloud Free Node.js** | A free Node.js hosting alternative | The provider advertises a control panel, automatic `package.json` installation, WebSockets, HTTPS, 2 vCPU, 3 GB RAM, and 15 GB storage. It also says free plans renew weekly. Confirm current availability, Node.js 22 support, persistent disk, and startup-command controls after signing in. [2] |

### Spaceify deployment steps

1. Sign in at <https://client.spaceify.eu/> and open the server dashboard.
2. Create a new server or application. Choose a **Node.js** runtime/image. Select Node.js 22 or newer if the panel offers multiple versions.
3. Wait until the server is created and open its **Files**, **File Manager**, or **Startup** area.
4. Upload the supplied **`index.js`** file to the server’s root directory. Do not rename it and do not upload the private Omega source repository.
5. Open **Startup**, **Configuration**, or the equivalent panel section and set the command to:

   ```bash
   node index.js
   ```

6. Open **Console** and press **Start** once. The live setup display will show download, dependency, configuration, and pairing phases. The first boot can take several minutes while the protected runtime is downloaded and installed.
7. Confirm that the panel’s disk is persistent and that **Restart on crash** or an equivalent automatic-restart setting is enabled. Do not repeatedly stop and start during first boot.

If Spaceify asks for a port, use the port assigned by Spaceify. Ordinary Telegram and WhatsApp operation does not require a public inbound webhook port, but the server must be allowed to make outbound HTTPS connections. If the panel provides a sleep or auto-suspend option, disable it for a bot that must remain online.

### Generic panel checklist

If your panel uses different names, look for these equivalent controls:

| Needed control | Possible panel label |
| --- | --- |
| Server creation | Create Server, New Application, Deploy App |
| Node.js runtime | NodeJS, Node.js Egg, Runtime, Docker Image |
| File upload | Files, File Manager, Upload |
| Startup command | Startup, Command, Entrypoint, Run Command |
| Live output | Console, Terminal, Logs |
| Persistent storage | Disk, Volume, Filesystem, Storage |
| Automatic recovery | Restart on crash, Auto-restart, Restart policy |

Never use a server type that is only a static website, serverless function, or short-lived worker. Omega needs a long-running Node.js process with writable persistent storage for WhatsApp authentication, settings, and media work.

## Deploy on a VPS

Install Node.js 22 or newer, create a private application directory, and place `index.js` inside it:

```bash
mkdir -p ~/omega-bot
cd ~/omega-bot
# upload index.js to this directory
node index.js
```

For a persistent VPS process, use the process manager supplied by your operating system or PM2:

```bash
pm2 start index.js --name omega-customer
pm2 save
```

Keep the application directory writable and persistent. Do not run the bot from a temporary directory because WhatsApp authentication and customer settings are stored locally.

## First-run setup

The wizard asks for the Telegram bot token first. In Telegram, open **@BotFather**, send `/newbot`, follow the instructions, and paste the resulting token into the panel console. Type `skip` if Telegram control is not required.

When Telegram is enabled, the wizard asks for the owner chat ID. Open the parent Omega bot and send `/getid` or `/id`; paste the numeric **Your user ID** into the console. This identifies the owner of this customer deployment only. It does not transfer the parent admin panel or the operator’s owner identity.

The wizard then asks for the WhatsApp controller number. Enter the number that should control this deployment, including the international country code. A short session name is requested before pairing so multiple connections remain identifiable. Pairing has a one-minute countdown. A completed session is reused on later restarts; abandoned, expired, revoked, or failed pairing attempts are removed instead of leaving stale controls behind.

If a setup item is skipped, the wizard continues with the available services. For example, Telegram can run without WhatsApp, and WhatsApp can run without Telegram. Missing Redis must not prevent ordinary commands from starting.

## Telegram owner and sudo access

The customer owner is configured during setup and can manage the customer bot. Additional users require sudo permission before they can use protected customer commands. Parent Force Join verification is applied through the authenticated Omega Core when the operator has allocated a Force Join policy.

The customer owner can use the Telegram restart control or `/restart` when an intentional restart is needed. Existing sessions and settings remain on disk. Normal parent policy and runtime updates are handled automatically and do not require repeatedly uploading `index.js`.

## Optional Redis configuration

Redis is optional for ordinary Telegram and WhatsApp commands. If Redis is unavailable, queue-backed workers enter a degraded state while normal bot interaction remains available.

From Telegram, open **Settings → Redis Storage** and paste either a normal URL:

```text
redis://default:password@host:6379
```

or the provider command format:

```text
redis-cli -u redis://default:password@host:15606
```

The runtime validates the value, hot-rebinds queue workers, and persists the allocation through the authenticated control plane. A restart is not required. **Clear Redis** stops Redis-backed workers only; it does not stop ordinary commands.

Never paste a real Redis password into public chats, screenshots, GitHub issues, or source files.

## WhatsApp session controls

Use the Telegram **Sessions** menu to add, name, resume, or purge a WhatsApp session. A session is considered ready only after its socket has reached the operational connected state. A durable record marked active while its socket is unavailable is treated as reconnecting rather than usable.

Use **Purge** only when you intentionally want to remove a session. Purging deletes that session’s local authentication and metadata and does not affect other sessions. A temporary transport or rate-limit failure preserves registered authentication and uses bounded recovery instead of treating the account as permanently logged out.

## Automatic updates

The bootstrap checks the stable GitHub manifest after startup and when the authenticated parent Core publishes a newer release signal. It verifies the manifest and every downloaded file with SHA-256 hashes, stages the replacement safely, installs changed production dependencies, and retains the previous working runtime if an update fails.

Do not delete the bootstrap `index.js`, the runtime directory, or the persistent application data directory. New commands, dependency updates, parent policies, and security fixes are delivered through the verified update channel.

## Troubleshooting

| Symptom | Safe action |
| --- | --- |
| Console appears idle during first start | Wait for dependency installation and the setup wizard; do not restart repeatedly. |
| Redis warning appears | Continue using ordinary commands, or configure Redis from Telegram Settings. |
| WhatsApp session shows reconnecting | Wait for the bounded cooldown, then use **Pair/Resume** once. Registered authentication is preserved. |
| Pairing code expired | Start Pair again; the failed attempt is removed automatically. |
| Telegram token is wrong | Stop the process, correct the local configuration, and start it once. |
| Panel reports an old process still running | Press Stop, wait for the old process to exit, then press Start once. |
| Update fails | Keep the process running long enough for rollback to complete; the previous working runtime is retained. |

## Security boundary

The customer release contains compiled runtime JavaScript and the public bootstrap, not the private TypeScript source or source maps. Compiled software must still be treated as executable software. Keep all tokens and storage credentials in the private panel environment, use persistent disk permissions, and do not share console screenshots containing secrets.

## Release channel

The stable release manifest is published at:

<https://raw.githubusercontent.com/pappy999666-dotcom/omega-customer-distribution/main/releases/stable/manifest.json>

The public distribution repository is:

<https://github.com/pappy999666-dotcom/omega-customer-distribution>

## Hosting references

[1]: https://zampto.net/create-server "Zampto official server-creation guide"
[2]: https://www.hidencloud.com/service/free-node-hosting "HidenCloud official free Node.js hosting page"
