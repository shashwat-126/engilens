import { useEffect, useState } from "react";
import { api, type Project, type RepoJob } from "../api";

export default function RepositoriesPanel({ project }: { project: Project }) {
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [jobs, setJobs] = useState<RepoJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setJobs(await api.listRepoJobs(project.id));
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  async function ingest(e: React.FormEvent) {
    e.preventDefault();
    if (!owner.trim() || !repo.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.startRepoIngest(project.id, owner.trim(), repo.trim(), branch.trim(), githubToken.trim());
      setOwner("");
      setRepo("");
      setBranch("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start ingestion");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <form className="repo-form" onSubmit={ingest}>
        <div className="repo-form-row">
          <input placeholder="owner" value={owner} onChange={(e) => setOwner(e.target.value)} />
          <span className="repo-slash">/</span>
          <input placeholder="repository" value={repo} onChange={(e) => setRepo(e.target.value)} />
          <input placeholder="branch (default)" value={branch} onChange={(e) => setBranch(e.target.value)} />
        </div>
        <input
          className="mono"
          placeholder="GitHub token (optional — raises the 60 req/hr limit, used once, never stored)"
          value={githubToken}
          onChange={(e) => setGithubToken(e.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={busy}>
          Index repository
        </button>
      </form>

      {error && <div className="chat-error">{error}</div>}

      <div className="job-list">
        {jobs.map((job) => (
          <div key={job.id} className="job-card">
            <div className="job-header">
              <span className="mono">
                {job.owner}/{job.repo}
                {job.branch ? `@${job.branch}` : ""}
              </span>
              <span className={`status-pill status-${job.status.toLowerCase()}`}>{job.status}</span>
            </div>
            {job.filesTotal > 0 && (
              <div className="job-progress">
                <div
                  className="job-progress-bar"
                  style={{ width: `${Math.round((job.filesDone / job.filesTotal) * 100)}%` }}
                />
                <span className="job-progress-label">
                  {job.filesDone}/{job.filesTotal} files
                </span>
              </div>
            )}
            {job.error && <div className="job-error mono">{job.error}</div>}
          </div>
        ))}
        {jobs.length === 0 && <p className="empty-hint">No repositories indexed yet.</p>}
      </div>
    </div>
  );
}
