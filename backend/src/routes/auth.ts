import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { pool } from "../db.js";
import { hashPassword, verifyPassword, signToken } from "../auth.js";
import { authenticate, type AuthedRequest } from "../rbac.js";
import { authRateLimit } from "../rateLimit.js";
import { asyncHandler } from "../asyncHandler.js";

export const authRouter = Router();

authRouter.get(
  "/me",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const result = await pool.query(`SELECT id, email, name FROM users WHERE id = $1`, [req.user!.id]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  })
);

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

authRouter.post(
  "/register",
  authRateLimit,
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { email, password, name } = parsed.data;

    const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
    if (existing.rows.length > 0) return res.status(409).json({ error: "Email already registered" });

    const id = uuid();
    await pool.query(`INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4)`, [
      id,
      email,
      hashPassword(password),
      name,
    ]);
    const token = signToken({ sub: id, email });
    res.status(201).json({ token, user: { id, email, name } });
  })
);

const loginSchema = z.object({ email: z.string().email(), password: z.string() });

authRouter.post(
  "/login",
  authRateLimit,
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { email, password } = parsed.data;

    const result = await pool.query<{ id: string; email: string; password_hash: string; name: string }>(
      `SELECT id, email, password_hash, name FROM users WHERE email = $1`,
      [email]
    );
    const user = result.rows[0];

    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = signToken({ sub: user.id, email: user.email });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  })
);
