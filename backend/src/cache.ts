import crypto from "node:crypto";
import { redis } from "./redis.js";

// Real Redis GET/SET with TTL -- the spec's `hash(question+project+context) -> Redis` design, literally.
const TTL_SECONDS = 10 * 60;

export function cacheKey(parts: string[]): string {
  return "chat:cache:" + crypto.createHash("sha256").update(parts.join("::")).digest("hex");
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const raw = await redis.get(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  await redis.set(key, JSON.stringify(value), "EX", TTL_SECONDS);
}
