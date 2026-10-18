import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "./auth.js";
import { pool } from "./db.js";
import { asyncHandler } from "./asyncHandler.js";

export interface AuthedRequest extends Request {
  user?: { id: string; email: string };
}

export function authenticate(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Missing token" });
  try {
    const payload = verifyToken(header.slice(7));
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

const ROLE_RANK: Record<string, number> = { VIEWER: 0, DEVELOPER: 1, ADMIN: 2, OWNER: 3 };

/** Requires the caller to be a member of the organization owning `req.params.projectId`
 * (or `organizationId` directly) with at least `minRole`. */
export function authorize(minRole: keyof typeof ROLE_RANK) {
  return asyncHandler(async (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    let organizationId = req.params.organizationId as string | undefined;
    if (!organizationId && req.params.projectId) {
      const proj = await pool.query<{ organization_id: string }>(
        `SELECT organization_id FROM projects WHERE id = $1`,
        [req.params.projectId]
      );
      organizationId = proj.rows[0]?.organization_id;
    }
    if (!organizationId) return res.status(400).json({ error: "Cannot resolve organization for RBAC check" });

    const membership = await pool.query<{ role: string }>(
      `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
      [organizationId, req.user.id]
    );
    const role = membership.rows[0]?.role;

    if (!role) return res.status(403).json({ error: "Not a member of this organization" });
    if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
      return res.status(403).json({ error: `Requires role >= ${minRole}` });
    }
    next();
  });
}
