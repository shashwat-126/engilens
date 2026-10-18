// Standalone ingestion worker process -- separate from server.ts so it can
// be scaled independently in docker-compose/production (more worker
// replicas without more API replicas). Both processes talk to the same
// Postgres and Redis; BullMQ handles coordination between them.
import { initSchema, pool } from "./db.js";
import { redis } from "./redis.js";
import { startIngestionWorker, shutdownQueue } from "./queue.js";

async function main() {
  await pool.query("SELECT 1");
  await initSchema();
  await redis.ping();

  startIngestionWorker();
  console.log("Ingestion worker started, waiting for jobs...");

  const shutdown = async () => {
    console.log("Shutting down worker...");
    await shutdownQueue();
    await pool.end();
    redis.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});
