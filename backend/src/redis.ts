import Redis from "ioredis";

// Real Redis, not a stand-in. BullMQ requires maxRetriesPerRequest: null on
// its own connections; this shared client is fine for cache/rate-limit use
// and BullMQ gets its own connections in queue.ts.
export const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

redis.on("error", (err) => {
  console.error("[redis] connection error:", err.message);
});
