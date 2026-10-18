const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000/api/v1";

export interface User {
  id: string;
  email: string;
  name: string;
}
export interface Org {
  id: string;
  name: string;
  role: string;
}
export interface Project {
  id: string;
  name: string;
  created_at?: string;
}
export interface DocumentRow {
  id: string;
  name: string;
  type: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  created_at: string;
  updated_at: string;
  error?: string | null;
}
export interface Citation {
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  relevance: number;
  supported: boolean;
}
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  citations?: Citation[];
}
export interface ChatResponse {
  conversationId: string;
  answer: string;
  citations: Citation[];
  fromCache: boolean;
  provider: string;
  model: string;
}
export interface ProviderInfo {
  name: string;
  label: string;
  configured: boolean;
  defaultModel: string;
}
export interface RepoJob {
  id: string;
  status: "PENDING" | "FETCHING_TREE" | "INGESTING" | "COMPLETED" | "FAILED";
  filesTotal: number;
  filesDone: number;
  owner: string;
  repo: string;
  branch: string;
  error?: string;
}
export interface Stats {
  documents: number;
  chunks: number;
  lastIndexedAt: string | null;
}

export interface DependencyNeighbors {
  file: string;
  dependsOn: string[];
  dependedOnBy: string[];
}
export interface DependencyGraph {
  nodes: string[];
  edges: { from: string; to: string }[];
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let token: string | null = localStorage.getItem("ekc_token");

export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem("ekc_token", t);
  else localStorage.removeItem("ekc_token");
}
export function getToken() {
  return token;
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.error ? JSON.stringify(body.error) : message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  register: (email: string, password: string, name: string) =>
    request<{ token: string; user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
    }),
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<User>("/auth/me"),
  listOrgs: () => request<Org[]>("/organizations"),
  createOrg: (name: string) =>
    request<Org>("/organizations", { method: "POST", body: JSON.stringify({ name }) }),
  listProjects: (orgId: string) => request<Project[]>(`/organizations/${orgId}/projects`),
  createProject: (orgId: string, name: string) =>
    request<Project>(`/organizations/${orgId}/projects`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  stats: (projectId: string) => request<Stats>(`/projects/${projectId}/stats`),

  listDocuments: (projectId: string) => request<DocumentRow[]>(`/projects/${projectId}/documents`),
  uploadDocument: (projectId: string, name: string, type: string, content: string) =>
    request<{ id: string; status: string }>(`/projects/${projectId}/documents`, {
      method: "POST",
      body: JSON.stringify({ name, type, content }),
    }),
  deleteDocument: (projectId: string, documentId: string) =>
    request<void>(`/projects/${projectId}/documents/${documentId}`, { method: "DELETE" }),

  startRepoIngest: (projectId: string, owner: string, repo: string, branch: string, githubToken: string) =>
    request<{ jobId: string; status: string }>(`/projects/${projectId}/repositories`, {
      method: "POST",
      body: JSON.stringify({
        owner,
        repo,
        ...(branch ? { branch } : {}),
        ...(githubToken ? { githubToken } : {}),
      }),
    }),
  getRepoJob: (projectId: string, jobId: string) =>
    request<RepoJob>(`/projects/${projectId}/repositories/${jobId}`),
  listRepoJobs: (projectId: string) => request<RepoJob[]>(`/projects/${projectId}/repositories`),

  listProviders: (projectId: string) => request<ProviderInfo[]>(`/projects/${projectId}/chat/providers`),
  ask: (
    projectId: string,
    question: string,
    conversationId: string | undefined,
    provider: string | undefined,
    model: string | undefined
  ) =>
    request<ChatResponse>(`/projects/${projectId}/chat`, {
      method: "POST",
      body: JSON.stringify({ question, conversationId, provider, model: model || undefined }),
    }),
  getConversation: (projectId: string, conversationId: string) =>
    request<ChatMessage[]>(`/projects/${projectId}/chat/${conversationId}`),

  getDependencyNeighbors: (projectId: string, file: string) =>
    request<DependencyNeighbors>(`/projects/${projectId}/dependencies?file=${encodeURIComponent(file)}`),
  getDependencyGraph: (projectId: string) =>
    request<DependencyGraph>(`/projects/${projectId}/dependencies/graph`),
};

export { ApiError };
