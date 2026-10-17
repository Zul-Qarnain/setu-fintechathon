import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp({ config, logger: true });
await app.listen({ port: config.PORT, host: '0.0.0.0' });
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => void app.close().then(() => process.exit(0)));
}
