import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { seedAdmin } from "./seed.js";

const config = loadConfig();
const db = openDb(config.dbPath);
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  if (seedAdmin(db, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, config.bcryptCost)) console.log("admin user created");
}

const server = createApp({ db, config }).listen(config.port, () => console.log(`commerce-api listening on :${config.port} (${config.env})`));

// Graceful shutdown: notun connection niye na, cholte thaka request shesh kore tarpor bondho (deploy er shomoy request haray na)
function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
