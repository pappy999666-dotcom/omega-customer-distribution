process.env.OMEGA_CUSTOMER_RUNTIME ??= 'true';
process.env.OMEGA_PLATFORM ??= 'pterodactyl';
process.env.OMEGA_RUNTIME_ROLE ??= 'customer';
import('./runtime.mjs').catch((error) => { console.error(error); process.exitCode = 1; });
