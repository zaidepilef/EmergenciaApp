import { config } from "./config.js";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";

const app = buildApp();

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ host: config.host, port: config.port });
