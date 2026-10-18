import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { pool } from "../db.js";
import { authenticate, authorize, type AuthedRequest } from "../rbac.js";
import { runIngestion } from "../ingestion.js";
import { createRepoJob, getRepoJob, listRepoJobsForProject, updateRepoJob } from "../repoJobs.js";
import {
  fetchDefaultBranch,
  fetchRawFile,
  fetchRepoTree,
  MAX_FILES_PER_REPO,
  MAX_FILE_BYTES,
  shouldIngestPath,
} from "../github.js";
import { asyncHandler } from "../asyncHandler.js";

export const repositoriesRouter = Router({ mergeParams: true });
repositoriesRouter.use(authenticate);

const ingestSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().optional(),
  // Request-scoped only -- never written to the DB. Raises GitHub's 60/hr
  // unauthenticated rate limit and allows private repos the token can read.
  githubToken: z.string().optional(),
});

repositoriesRouter.post(
  "/",
  authorize("DEVELOPER"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = ingestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { owner, repo, githubToken } = parsed.data;
    const projectId = req.params.projectId;

    const job = await createRepoJob({ projectId, owner, repo, branch: parsed.data.branch ?? "" });
    res.status(202).json({ jobId: job.id, status: job.status });

    // Runs after the response is sent -- same "don't block on 20k files"
    // pattern as document upload, just for a whole repo at once. Each file
    // goes through the exact same runIngestion() the BullMQ worker calls for
    // manual uploads -- this path is sequential (each file needs its own
    // GitHub fetch, and per-file progress tracking is simplest inline) rather
    // than queued, but the chunk/embed/store code is identical either way.
    runRepoIngestion(job.id, githubToken).catch(async (err) => {
      await updateRepoJob(job.id, { status: "FAILED", error: String(err) });
    });
  })
);

async function runRepoIngestion(jobId: string, githubToken?: string) {
  const job = await getRepoJob(jobId);
  if (!job) return;

  await updateRepoJob(jobId, { status: "FETCHING_TREE" });
  const branch = job.branch || (await fetchDefaultBranch(job.owner, job.repo, githubToken));
  await updateRepoJob(jobId, { branch });

  const tree = await fetchRepoTree(job.owner, job.repo, branch, githubToken);
  const files = tree
    .filter((t) => t.type === "blob" && shouldIngestPath(t.path) && (t.size ?? 0) <= MAX_FILE_BYTES)
    .slice(0, MAX_FILES_PER_REPO);

  await updateRepoJob(jobId, { status: "INGESTING", filesTotal: files.length });

  for (const f of files) {
    try {
      const content = await fetchRawFile(job.owner, job.repo, branch, f.path, githubToken);
      const docId = uuid();
      await pool.query(
        `INSERT INTO documents (id, project_id, name, type, source, status) VALUES ($1, $2, $3, 'code', $4, 'PENDING')`,
        [docId, job.projectId, `${job.owner}/${job.repo}/${f.path}`, content]
      );
      await runIngestion(docId);
    } catch {
      // one bad file shouldn't fail the whole repo -- skip and keep going
    } finally {
      const current = await getRepoJob(jobId);
      await updateRepoJob(jobId, { filesDone: (current?.filesDone ?? 0) + 1 });
    }
  }

  await updateRepoJob(jobId, { status: "COMPLETED" });
}

repositoriesRouter.get(
  "/:jobId",
  authorize("VIEWER"),
  asyncHandler(async (req, res) => {
    const job = await getRepoJob(req.params.jobId);
    if (!job || job.projectId !== req.params.projectId) return res.status(404).json({ error: "Not found" });
    res.json(job);
  })
);

repositoriesRouter.get(
  "/",
  authorize("VIEWER"),
  asyncHandler(async (req, res) => {
    res.json(await listRepoJobsForProject(req.params.projectId));
  })
);
