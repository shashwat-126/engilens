import { pool } from "./db.js";

export interface DependencyEdge {
  raw: string; // import string exactly as written
  resolvedTo: string; // best-effort resolved path; external packages kept as-is
}

// Deliberately regex-based, not a full parser (tree-sitter/ts-morph would be
// the real-parser upgrade) -- but a real, working static-analysis pass, not
// a placeholder. Handles the common import/require/from-import shapes.
const JS_IMPORT_RE =
  /(?:import\s+(?:[\w*${}\s,]+\s+from\s+)?|export\s+(?:[\w*{}\s,]+\s+from\s+)?|require\(\s*)['"]([^'"]+)['"]/g;
const PY_IMPORT_RE = /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+(?:\s*,\s*[\w.]+)*))/gm;

function resolveRelativeJs(fromFile: string, importPath: string): string {
  if (!importPath.startsWith(".")) return importPath; // external package (npm) -- not a project file
  const fromDir = fromFile.split("/").slice(0, -1);
  const stack = [...fromDir];
  for (const part of importPath.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

export function extractDependencyEdges(fileName: string, source: string): DependencyEdge[] {
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  const edges: DependencyEdge[] = [];

  if (["ts", "tsx", "js", "jsx"].includes(ext)) {
    JS_IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = JS_IMPORT_RE.exec(source))) {
      const raw = m[1];
      edges.push({ raw, resolvedTo: resolveRelativeJs(fileName, raw) });
    }
  } else if (ext === "py") {
    PY_IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PY_IMPORT_RE.exec(source))) {
      const raw = (m[1] ?? m[2] ?? "").trim();
      if (!raw) continue;
      for (const name of raw.split(",").map((s) => s.trim())) {
        if (name) edges.push({ raw: name, resolvedTo: name.replace(/\./g, "/") });
      }
    }
  }
  return edges;
}

export interface DependencyNeighbors {
  file: string;
  dependsOn: string[]; // outgoing: files/packages this file imports
  dependedOnBy: string[]; // incoming: project files that import this file
}

// JS/TS imports routinely omit the extension ('../auth' for 'auth.ts'), and
// can point at a directory's index file. A single-file extraction pass
// can't know which extension the target actually has -- resolve against
// the project's real ingested file names instead, once they exist.
const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];

export async function resolveEdgeTarget(projectId: string, resolvedTo: string, isRelative: boolean): Promise<string> {
  if (!isRelative) return resolvedTo; // external package (npm/pip) -- nothing in the project to resolve against
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = resolvedTo + suffix;
    const result = await pool.query(`SELECT 1 FROM documents WHERE project_id = $1 AND name = $2 LIMIT 1`, [
      projectId,
      candidate,
    ]);
    if ((result.rowCount ?? 0) > 0) return candidate;
  }
  return resolvedTo; // target not ingested (yet) -- keep the best-effort guess rather than dropping the edge
}

/** Ingestion order isn't guaranteed to put a file before its dependents, so
 * a relative import can be unresolvable at the moment its importing file is
 * ingested. Called after every ingestion (see ingestion.ts) to retry
 * resolving this project's edges against whatever's been ingested since --
 * self-healing rather than order-dependent. Cheap at portfolio-project
 * scale (a handful of exact-match lookups per unresolved edge). */
export async function finalizeDependencyEdges(projectId: string): Promise<void> {
  const edges = await pool.query<{ id: string; to_file: string }>(
    `SELECT id, to_file FROM dependency_edges WHERE project_id = $1 AND import_raw LIKE '.%'`,
    [projectId]
  );
  for (const edge of edges.rows) {
    const alreadyResolved = await pool.query(`SELECT 1 FROM documents WHERE project_id = $1 AND name = $2 LIMIT 1`, [
      projectId,
      edge.to_file,
    ]);
    if ((alreadyResolved.rowCount ?? 0) > 0) continue; // already points at a real ingested file

    const resolved = await resolveEdgeTarget(projectId, edge.to_file, true);
    if (resolved !== edge.to_file) {
      await pool.query(`UPDATE dependency_edges SET to_file = $1 WHERE id = $2`, [resolved, edge.id]);
    }
  }
}

/** "What does X depend on, and what depends on X" -- the query the spec's
 * Phase 10 dependency graph feature is meant to answer. Re-resolves before
 * reading: ingestion order across files isn't guaranteed, so a write-time-only
 * resolution (finalizeDependencyEdges, called after each ingestion) can race
 * and leave an edge stale until another file happens to be ingested later.
 * Resolving again here makes every read correct regardless of that race, at
 * the cost of a handful of extra lookups on a non-hot-path endpoint. */
export async function getDependencyNeighbors(projectId: string, file: string): Promise<DependencyNeighbors> {
  await finalizeDependencyEdges(projectId);

  const outgoing = await pool.query<{ to_file: string }>(
    `SELECT DISTINCT to_file FROM dependency_edges WHERE project_id = $1 AND from_file = $2 ORDER BY to_file`,
    [projectId, file]
  );
  const incoming = await pool.query<{ from_file: string }>(
    `SELECT DISTINCT from_file FROM dependency_edges WHERE project_id = $1 AND to_file = $2 ORDER BY from_file`,
    [projectId, file]
  );
  return {
    file,
    dependsOn: outgoing.rows.map((r) => r.to_file),
    dependedOnBy: incoming.rows.map((r) => r.from_file),
  };
}

export interface DependencyGraph {
  nodes: string[];
  edges: { from: string; to: string }[];
}

/** Full graph for a project, for the frontend's graph view. Capped to keep
 * the response (and the force-directed layout) sane. */
export async function getFullDependencyGraph(projectId: string, limit = 500): Promise<DependencyGraph> {
  await finalizeDependencyEdges(projectId);

  const result = await pool.query<{ from_file: string; to_file: string }>(
    `SELECT DISTINCT from_file, to_file FROM dependency_edges WHERE project_id = $1 LIMIT $2`,
    [projectId, limit]
  );
  const nodes = new Set<string>();
  const edges = result.rows.map((r) => {
    nodes.add(r.from_file);
    nodes.add(r.to_file);
    return { from: r.from_file, to: r.to_file };
  });
  return { nodes: [...nodes], edges };
}
