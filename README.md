# Omega Customer Distribution

This private repository is the release channel for the source-protected Omega customer runtime. Customers upload only the small root `index.js` bootstrap to a compatible Node.js panel. The bootstrap downloads the verified stable release, installs production dependencies with lifecycle scripts disabled, preserves the previous working release when an update fails, and then starts the local runtime.

The distribution repository contains compiled runtime artifacts only. TypeScript source files and source maps are not published.

## Customer panel setup

Upload `index.js` as the server entrypoint. Set the startup command to `node index.js`. The bootstrap uses the stable channel by default and can be pinned with `OMEGA_UPDATE_CHANNEL` or overridden with `OMEGA_UPDATE_REPO`. Set `OMEGA_AUTO_UPDATE=false` only when deliberately pinning a deployment.

Redis is optional for ordinary WhatsApp and Telegram controls. If Redis or the secure storage tunnel is unavailable, queue-backed bulk workers remain disabled and the core bot continues in degraded mode. Critical failures are shown in the compact terminal stream; routine logs remain in the local rotating log files.
