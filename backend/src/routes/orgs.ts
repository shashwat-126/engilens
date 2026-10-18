import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { pool } from "../db.js";
import { authenticate, authorize, type AuthedRequest } from "../rbac.js";
import { asyncHandler } from "../asyncHandler.js";

export const orgsRouter = Router();
orgsRouter.use(authenticate);

orgsRouter.post(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = z.object({ name: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const id = uuid();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [id, parsed.data.name]);
      await client.query(
        `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [id, req.user!.id]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    res.status(201).json({ id, name: parsed.data.name, role: "OWNER" });
  })
);

orgsRouter.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const result = await pool.query(
      `SELECT o.id, o.name, m.role FROM organizations o
       JOIN organization_members m ON m.organization_id = o.id
       WHERE m.user_id = $1`,
      [req.user!.id]
    );
    res.json(result.rows);
  })
);

orgsRouter.post(
  "/:organizationId/members",
  authorize("ADMIN"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = z
      .object({ userId: z.string(), role: z.enum(["OWNER", "ADMIN", "DEVELOPER", "VIEWER"]) })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    // Privilege-escalation guard: an ADMIN could otherwise grant OWNER (or
    // re-grant ADMIN to themselves after being demoted) despite only holding
    // ADMIN rank. Only an existing OWNER may assign the OWNER role.
    if (parsed.data.role === "OWNER") {
      const caller = await pool.query<{ role: string }>(
        `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
        [req.params.organizationId, req.user!.id]
      );
      if (caller.rows[0]?.role !== "OWNER") {
        return res.status(403).json({ error: "Only an OWNER can grant the OWNER role" });
      }
    }

    await pool.query(
      `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [req.params.organizationId, parsed.data.userId, parsed.data.role]
    );
    res.status(201).json({ ok: true });
  })
);

// ---- Projects ----

orgsRouter.post(
  "/:organizationId/projects",
  authorize("DEVELOPER"),
  asyncHandler(async (req, res) => {
    const parsed = z.object({ name: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const id = uuid();
    await pool.query(`INSERT INTO projects (id, organization_id, name) VALUES ($1, $2, $3)`, [
      id,
      req.params.organizationId,
      parsed.data.name,
    ]);
    res.status(201).json({ id, name: parsed.data.name });
  })
);

orgsRouter.get(
  "/:organizationId/projects",
  authorize("VIEWER"),
  asyncHandler(async (req, res) => {
    const result = await pool.query(`SELECT id, name, created_at FROM projects WHERE organization_id = $1`, [
      req.params.organizationId,
    ]);
    res.json(result.rows);
  })
);
