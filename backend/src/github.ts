// Talks to api.github.com (tree listing) and raw.githubusercontent.com (file
// content). Unauthenticated GitHub API is rate-limited to 60 req/hr — pass a
// token (never persisted, request-scoped only) for real usage.

export interface GitTreeItem {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
}

const IGNORE_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "vendor",
  ".next",
  "target",
  "__pycache__",
  "venv",
  ".venv",
  "coverage",
]);

const SUPPORTED_EXT = new Set([
  "js",
  "ts",
  "tsx",
  "jsx",
  "py",
  "java",
  "go",
  "rs",
  "md",
  "mdx",
  "json",
  "yaml",
  "yml",
  "sql",
  "html",
  "css",
  "txt",
]);

export const MAX_FILE_BYTES = 200_000;
export const MAX_FILES_PER_REPO = 200; // sandbox-friendly cap; raise for real deployments

export function shouldIngestPath(path: string): boolean {
  const segments = path.split("/");
  if (segments.some((s) => IGNORE_SEGMENTS.has(s))) return false;
  const ext = path.includes(".") ? path.split(".").pop()!.toLowerCase() : "";
  return SUPPORTED_EXT.has(ext);
}

function ghHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "engineering-knowledge-copilot",
    Accept: "application/vnd.github+json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function fetchDefaultBranch(owner: string, repo: string, token?: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: ghHeaders(token) });
  if (!res.ok) throw new Error(`GitHub repo lookup failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { default_branch: string };
  return data.default_branch;
}

export async function fetchRepoTree(
  owner: string,
  repo: string,
  branch: string,
  token?: string
): Promise<GitTreeItem[]> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { headers: ghHeaders(token) }
  );
  if (!res.ok) throw new Error(`GitHub tree fetch failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { tree: GitTreeItem[]; truncated: boolean };
  return data.tree;
}

export async function fetchRawFile(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  token?: string
): Promise<string> {
  const res = await fetch(
    `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  );
  if (!res.ok) throw new Error(`GitHub raw fetch failed for ${path}: ${res.status}`);
  return res.text();
}
