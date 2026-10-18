import pg from "pg";

const { Pool } = pg;

// Real PostgreSQL + pgvector, not a stand-in. Connection string points at a
// local Postgres by default (see docker-compose.yml / README for setup);
// override with DATABASE_URL in any other environment.
export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgresql://eng_copilot:dev_password_change_me@localhost:5432/eng_copilot",
});

export const EMBEDDING_DIM = 256;

export async function initSchema(): Promise<void> {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- role: OWNER | ADMIN | DEVELOPER | VIEWER
    CREATE TABLE IF NOT EXISTS organization_members (
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      PRIMARY KEY (organization_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY,
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- status: PENDING | PROCESSING | COMPLETED | FAILED
    CREATE TABLE IF NOT EXISTS documents (
      id UUID PRIMARY KEY,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id UUID PRIMARY KEY,
      document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      start_line INTEGER,
      end_line INTEGER,
      language TEXT,
      symbol_name TEXT,
      embedding vector(${EMBEDDING_DIM}) NOT NULL,
      content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_project ON chunks(project_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
    -- HNSW: approximate nearest-neighbor index for cosine distance, the real
    -- ANN structure pgvector ships -- replaces the O(n) JS cosine-sim loop
    -- the SQLite stand-in used.
    CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
    -- GIN index over the generated tsvector: real Postgres full-text search
    -- for the keyword side of hybrid retrieval, not a JS token-overlap loop.
    CREATE INDEX IF NOT EXISTS idx_chunks_content_tsv ON chunks USING gin (content_tsv);

    CREATE TABLE IF NOT EXISTS conversations (
      id UUID PRIMARY KEY,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY,
      conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL, -- user | assistant
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS citations (
      id UUID PRIMARY KEY,
      message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      chunk_id UUID NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      start_line INTEGER,
      end_line INTEGER,
      supported BOOLEAN NOT NULL DEFAULT true
    );

    -- Code dependency graph: one row per import/require edge discovered
    -- during ingestion (see dependencyGraph.ts).
    CREATE TABLE IF NOT EXISTS dependency_edges (
      id UUID PRIMARY KEY,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      from_file TEXT NOT NULL,
      to_file TEXT NOT NULL,
      import_raw TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_dep_edges_project ON dependency_edges(project_id);
    CREATE INDEX IF NOT EXISTS idx_dep_edges_from ON dependency_edges(project_id, from_file);
    CREATE INDEX IF NOT EXISTS idx_dep_edges_to ON dependency_edges(project_id, to_file);
  `);
}

/** Formats a JS number[] as the text literal pgvector expects for a `vector` column/param. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
