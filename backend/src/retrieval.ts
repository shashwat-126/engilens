import { pool, toVectorLiteral } from "./db.js";
import { embeddingProvider } from "./embeddings.js";
import { rerank } from "./reranker.js";
import type { RetrievedChunk } from "./llm.js";

interface CandidateRow {
  id: string;
  content: string;
  file_path: string;
  start_line: number | null;
  end_line: number | null;
  symbol_name: string | null;
  vector_score: number | null;
  keyword_score: number | null;
}

/** Hybrid search, now for real: pgvector's HNSW index for the vector side
 * (cosine similarity via the `<=>` operator), Postgres full-text search
 * (`ts_rank` over the generated `tsvector` column) for the keyword side,
 * fused by chunk id, then passed through a BM25 reranking stage
 * (reranker.ts) to produce the final top-K. */
export async function hybridSearch(
  projectId: string,
  query: string,
  k = 5,
  candidatePoolSize = 20
): Promise<RetrievedChunk[]> {
  const qEmbedding = toVectorLiteral(embeddingProvider.embed(query));

  const [vectorResult, keywordResult] = await Promise.all([
    pool.query<CandidateRow>(
      `SELECT id, content, file_path, start_line, end_line, symbol_name,
              1 - (embedding <=> $1::vector) AS vector_score, NULL AS keyword_score
       FROM chunks
       WHERE project_id = $2
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [qEmbedding, projectId, candidatePoolSize]
    ),
    pool.query<CandidateRow>(
      `SELECT id, content, file_path, start_line, end_line, symbol_name,
              NULL AS vector_score, ts_rank(content_tsv, plainto_tsquery('english', $1)) AS keyword_score
       FROM chunks
       WHERE project_id = $2 AND content_tsv @@ plainto_tsquery('english', $1)
       ORDER BY keyword_score DESC
       LIMIT $3`,
      [query, projectId, candidatePoolSize]
    ),
  ]);

  if (vectorResult.rows.length === 0 && keywordResult.rows.length === 0) return [];

  // Fuse the two candidate sets by chunk id -- a chunk found by both gets
  // both scores; one found by only one side gets 0 for the other.
  const byId = new Map<string, CandidateRow & { vector_score: number; keyword_score: number }>();
  for (const row of vectorResult.rows) {
    byId.set(row.id, { ...row, vector_score: row.vector_score ?? 0, keyword_score: 0 });
  }
  for (const row of keywordResult.rows) {
    const existing = byId.get(row.id);
    if (existing) existing.keyword_score = row.keyword_score ?? 0;
    else byId.set(row.id, { ...row, vector_score: 0, keyword_score: row.keyword_score ?? 0 });
  }

  const maxKeyword = Math.max(...[...byId.values()].map((r) => r.keyword_score), 1e-6);
  const candidates = [...byId.values()].map((r) => ({
    id: r.id,
    content: r.content,
    filePath: r.file_path,
    startLine: r.start_line,
    endLine: r.end_line,
    symbolName: r.symbol_name,
    vectorScore: r.vector_score, // already in [0,1] from pgvector
    keywordScoreNormalized: r.keyword_score / maxKeyword, // normalize ts_rank into [0,1] for fusion
  }));

  // Coarse fused score decides the candidate pool order going into rerank();
  // rerank() then does the real second-pass scoring (BM25 + signals).
  candidates.sort((a, b) => (0.65 * b.vectorScore + 0.35 * b.keywordScoreNormalized) - (0.65 * a.vectorScore + 0.35 * a.keywordScoreNormalized));
  const pool_ = candidates.slice(0, candidatePoolSize);

  const reranked = rerank(query, pool_, k);

  return reranked.map((c) => ({
    id: c.id,
    content: c.content,
    filePath: c.filePath,
    startLine: c.startLine,
    endLine: c.endLine,
    score: Number(c.rerankScore.toFixed(4)),
  }));
}
