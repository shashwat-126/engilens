import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { runIngestion } from "./ingestion.js";

// BullMQ wants its own connection instances (not shared with app code) --
// this is the real queue the spec asked for, replacing the in-process
// setImmediate stand-in.
const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const ingestionQueue = new Queue<{ documentId: string }>("document-ingestion", { connection });

export async function enqueueIngestion(documentId: string): Promise<void> {
  await ingestionQueue.add(
    "ingest",
    { documentId },
    { removeOnComplete: { count: 200 }, removeOnFail: { count: 200 }, attempts: 2, backoff: { type: "exponential", delay: 2000 } }
  );
}

let worker: Worker<{ documentId: string }> | null = null;

/** Starts the in-process worker that actually consumes the queue. Called
 * once from server.ts. In a real multi-instance deployment this would run
 * as its own process/pod (`npm run worker`), separate from the API -- kept
 * in-process here for a one-command local dev experience, but the queue
 * itself is real Redis, so a standalone worker process would Just Work
 * against the same Redis instance. */
export function startIngestionWorker(): Worker<{ documentId: string }> {
  if (worker) return worker;
  worker = new Worker<{ documentId: string }>(
    "document-ingestion",
    async (job: Job<{ documentId: string }>) => {
      await runIngestion(job.data.documentId);
    },
    { connection, concurrency: 4 }
  );
  worker.on("failed", (job, err) => {
    console.error(`[ingestion-worker] job ${job?.id} (document ${job?.data.documentId}) failed:`, err.message);
  });
  worker.on("error", (err) => {
    console.error("[ingestion-worker] worker error:", err.message);
  });
  return worker;
}

/** Closes the worker, the queue, and the shared BullMQ Redis connection --
 * needed in tests (and graceful shutdown generally), since an open BullMQ
 * connection keeps the Node process alive indefinitely otherwise. */
export async function shutdownQueue(): Promise<void> {
  await worker?.close();
  worker = null;
  await ingestionQueue.close();
  connection.disconnect();
}
