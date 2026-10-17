import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { seedIfEmpty } from './seed.js';

const config = loadConfig();
const app = await buildApp({ config, logger: true });

// Seed synthetic data if database is empty
const auditResult = await seedIfEmpty(app.ctx);
if (auditResult) {
  console.log(
    `Seeded ${auditResult.auditHead.count} audit events, head_hash=${auditResult.auditHead.head_hash}`
  );
}

await app.listen({ port: config.PORT, host: '0.0.0.0' });
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => void app.close().then(() => process.exit(0)));
}
