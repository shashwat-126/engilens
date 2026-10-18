import { useEffect, useState } from "react";
import { api, type Project, type Stats } from "../api";

export default function StatsBar({ project }: { project: Project }) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const s = await api.stats(project.id);
      if (!cancelled) setStats(s);
    }
    load();
    const interval = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [project.id]);

  if (!stats) return null;

  return (
    <div className="stats-bar">
      <div className="stat">
        <span className="stat-value">{stats.documents}</span>
        <span className="stat-label">documents</span>
      </div>
      <div className="stat">
        <span className="stat-value">{stats.chunks}</span>
        <span className="stat-label">chunks</span>
      </div>
      <div className="stat">
        <span className="stat-value">{stats.lastIndexedAt ? timeAgo(stats.lastIndexedAt) : "—"}</span>
        <span className="stat-label">last indexed</span>
      </div>
    </div>
  );
}

function timeAgo(isoLike: string): string {
  const then = new Date(isoLike.replace(" ", "T") + "Z").getTime();
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  return `${Math.round(diffSec / 3600)}h ago`;
}
