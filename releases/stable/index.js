process.env.OMEGA_CUSTOMER_RUNTIME ??= 'true';
process.env.OMEGA_PLATFORM ??= 'panel';
process.env.OMEGA_RUNTIME_ROLE ??= 'customer';
process.env.OMEGA_RUNTIME_VERSION ??= '1.2.29';
process.env.YOUTUBE_DL_DIR ??= `${process.cwd()}/vendor/yt-dlp`;
process.env.YOUTUBE_DL_SKIP_DOWNLOAD ??= '1';
import('./runtime.mjs').catch((error) => { console.error(error); process.exitCode = 1; });
