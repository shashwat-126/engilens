import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { pool } from "../db.js";
import { authenticate, authorize } from "../rbac.js";
import { enqueueIngestion } from "../queue.js";
import { asyncHandler } from "../asyncHandler.js";

export const documentsRouter = Router({ mergeParams: true });
documentsRouter.use(authenticate);

// Upload a text-based document (txt/md/code file). Content is sent as plain
// text in the body -- swap for multipart+S3 for real file uploads, and add
// a PDF-to-text step in ingestion.ts for PDFs (see README).
documentsRouter.post(
  "/",
  authorize("DEVELOPER"),
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({ name: z.string().min(1), type: z.string().min(1), content: z.string() })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const id = uuid();
    await pool.query(
      `INSERT INTO documents (id, project_id, name, type, source, status) VALUES ($1, $2, $3, $4, $5, 'PENDING')`,
      [id, req.params.projectId, parsed.data.name, parsed.data.type, parsed.data.content]
    );

    await enqueueIngestion(id);
    res.status(202).json({ id, status: "PENDING" });
  })
);

documentsRouter.get(
  "/",
  authorize("VIEWER"),
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT id, name, type, status, created_at, updated_at FROM documents WHERE project_id = $1 ORDER BY created_at DESC`,
      [req.params.projectId]
    );
    res.json(result.rows);
  })
);

documentsRouter.get(
  "/:documentId",
  authorize("VIEWER"),
  asyncHandler(async (req, res) => {
    const docResult = await pool.query(
      `SELECT id, name, type, status, error, created_at, updated_at FROM documents WHERE id = $1 AND project_id = $2`,
      [req.params.documentId, req.params.projectId]
    );
    const doc = docResult.rows[0];
    if (!doc) return res.status(404).json({ error: "Not found" });

    const chunkCount = await pool.query<{ c: string }>(`SELECT COUNT(*) c FROM chunks WHERE document_id = $1`, [
      req.params.documentId,
    ]);

    res.json({ ...doc, chunkCount: Number(chunkCount.rows[0].c) });
  })
);

documentsRouter.delete(
  "/:documentId",
  authorize("ADMIN"),
  asyncHandler(async (req, res) => {
    // chunks/dependency_edges cascade via ON DELETE CASCADE
    await pool.query(`DELETE FROM documents WHERE id = $1 AND project_id = $2`, [
      req.params.documentId,
      req.params.projectId,
    ]);
    res.status(204).send();
  })
);
