import { v4 as uuid } from "uuid";
import { redis } from "./redis.js";

export interface RepoJob {
  id: string;
  projectId: string;
  owner: string;
  repo: string;
  branch: string;
  status: "PENDING" | "FETCHING_TREE" | "INGESTING" | "COMPLETED" | "FAILED";
  filesTotal: number;
  filesDone: number;
  error?: string;
  createdAt: string;
}

const TTL_SECONDS = 60 * 60 * 24; // job progress doesn't need to live forever
const jobKey = (id: string) => `repojob:${id}`;
const projectIndexKey = (projectId: string) => `repojob:project:${projectId}`;

export async function createRepoJob(input: Pick<RepoJob, "projectId" | "owner" | "repo" | "branch">): Promise<RepoJob> {
  const job: RepoJob = {
    id: uuid(),
    status: "PENDING",
    filesTotal: 0,
    filesDone: 0,
    createdAt: new Date().toISOString(),
    ...input,
  };
  await redis.set(jobKey(job.id), JSON.stringify(job), "EX", TTL_SECONDS);
  await redis.sadd(projectIndexKey(input.projectId), job.id);
  await redis.expire(projectIndexKey(input.projectId), TTL_SECONDS);
  return job;
}

export async function getRepoJob(id: string): Promise<RepoJob | undefined> {
  const raw = await redis.get(jobKey(id));
  return raw ? (JSON.parse(raw) as RepoJob) : undefined;
}

export async function updateRepoJob(id: string, patch: Partial<RepoJob>): Promise<void> {
  const current = await getRepoJob(id);
  if (!current) return;
  await redis.set(jobKey(id), JSON.stringify({ ...current, ...patch }), "EX", TTL_SECONDS);
}

export async function listRepoJobsForProject(projectId: string): Promise<RepoJob[]> {
  const ids = await redis.smembers(projectIndexKey(projectId));
  if (ids.length === 0) return [];
  const raws = await redis.mget(ids.map(jobKey));
  return raws
    .filter((r): r is string => r !== null)
    .map((r) => JSON.parse(r) as RepoJob)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
