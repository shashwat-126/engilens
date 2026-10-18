import { Router } from "express";
import { pool } from "../db.js";
import { authenticate, authorize } from "../rbac.js";
import { asyncHandler } from "../asyncHandler.js";

export const projectsRouter = Router({ mergeParams: true });
projectsRouter.use(authenticate);

projectsRouter.get(
  "/:projectId/stats",
  authorize("VIEWER"),
  asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const [documents, chunks, lastIndexed] = await Promise.all([
      pool.query<{ c: string }>(`SELECT COUNT(*) c FROM documents WHERE project_id = $1`, [projectId]),
      pool.query<{ c: string }>(`SELECT COUNT(*) c FROM chunks WHERE project_id = $1`, [projectId]),
      pool.query<{ t: string | null }>(
        `SELECT MAX(updated_at) t FROM documents WHERE project_id = $1 AND status = 'COMPLETED'`,
        [projectId]
      ),
    ]);

    res.json({
      documents: Number(documents.rows[0].c),
      chunks: Number(chunks.rows[0].c),
      lastIndexedAt: lastIndexed.rows[0].t,
    });
  })
);
