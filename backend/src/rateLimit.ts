import type { NextFunction, Request, Response } from "express";
import { redis } from "./redis.js";
import type { AuthedRequest } from "./rbac.js";

// Real Redis INCR+EXPIRE fixed-window limiter -- exactly the
// `rate_limit:user:<id>` design from the spec, not an in-process Map.
function createRateLimiter(windowSeconds: number, limit: number, keyOf: (req: Request) => string) {
  return async function rateLimiter(req: Request, res: Response, next: NextFunction) {
    const key = `rate_limit:${keyOf(req)}`;
    try {
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, windowSeconds);
      }
      if (count > limit) {
        const ttl = await redis.ttl(key);
        res.setHeader("Retry-After", String(Math.max(ttl, 1)));
        return res.status(429).json({ error: "Rate limit exceeded", retryAfterSec: Math.max(ttl, 1) });
      }
      next();
    } catch (err) {
      // Redis being unavailable shouldn't take the API down -- fail open,
      // but log loudly since rate limiting is silently disabled until Redis
      // is back.
      console.error("[rateLimit] Redis error, failing open:", err);
      next();
    }
  };
}

/** Per-user (or per-IP if unauthenticated) chat-question limit -- matches the
 * "Team tier: 100 req/hr" example from the spec. */
export const rateLimit = createRateLimiter(60 * 60, 100, (req) => (req as AuthedRequest).user?.id ?? req.ip ?? "anon");

/** Tighter, IP-keyed limit for unauthenticated auth endpoints -- without
 * this, /auth/login has zero brute-force protection. */
export const authRateLimit = createRateLimiter(15 * 60, 10, (req) => `auth:${req.ip ?? "anon"}`);
