import { createApp } from "./app.js";
import { initSchema, pool } from "./db.js";
import { redis } from "./redis.js";
import { startIngestionWorker } from "./queue.js";

async function main() {
  await pool.query("SELECT 1"); // fail fast with a clear error if Postgres is unreachable
  await initSchema();
  await redis.ping(); // fail fast if Redis is unreachable

  startIngestionWorker();

  const app = createApp();
  const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
  app.listen(PORT, () => {
    console.log(`Engineering Copilot backend listening on http://localhost:${PORT}`);
    console.log(`LLM provider: ${process.env.ANTHROPIC_API_KEY ? "Anthropic" : "Mock (offline, extractive)"}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
