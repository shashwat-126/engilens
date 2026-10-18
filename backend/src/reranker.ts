// A real second-stage reranker over the retrieval candidate pool -- not a
// neural cross-encoder (that needs a model host; none is reachable from
// this environment -- see README), but a genuine statistical reranking
// pass, which is how a lot of production hybrid-search reranking actually
// works before/alongside a cross-encoder. Swap `rerank()`'s scoring for a
// cross-encoder call and the calling code in retrieval.ts doesn't change.

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
}

/** Real Okapi BM25, computed over the candidate pool (the already-narrowed
 * set from coarse retrieval) rather than the full corpus -- exactly how a
 * second-stage reranker is supposed to work; a corpus-wide BM25 index lives
 * in the coarse retrieval stage (Postgres full-text search, see
 * retrieval.ts), not here. */
function bm25Scores(query: string, docs: string[], k1 = 1.5, b = 0.75): number[] {
  const queryTerms = tokenize(query);
  const docTokens = docs.map(tokenize);
  const docLengths = docTokens.map((t) => t.length);
  const avgDocLength = docLengths.reduce((a, len) => a + len, 0) / (docLengths.length || 1);
  const N = docs.length;

  const df = new Map<string, number>();
  for (const term of new Set(queryTerms)) {
    df.set(term, docTokens.filter((tokens) => tokens.includes(term)).length);
  }

  return docTokens.map((tokens, i) => {
    const termFreq = new Map<string, number>();
    for (const t of tokens) termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
    let score = 0;
    for (const term of queryTerms) {
      const f = termFreq.get(term) ?? 0;
      if (f === 0) continue;
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const denom = f + k1 * (1 - b + (b * docLengths[i]) / avgDocLength);
      score += idf * ((f * (k1 + 1)) / denom);
    }
    return score;
  });
}

export interface RerankInput {
  content: string;
  filePath: string;
  symbolName?: string | null;
  vectorScore: number; // cosine similarity in [0,1], from the coarse retrieval stage
}

export function rerank<T extends RerankInput>(query: string, candidates: T[], topK: number): (T & { rerankScore: number })[] {
  if (candidates.length === 0) return [];

  const bm25 = bm25Scores(query, candidates.map((c) => c.content));
  const maxBm25 = Math.max(...bm25, 1e-6);
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 3);

  const scored = candidates.map((c, i) => {
    const normalizedBm25 = bm25[i] / maxBm25;
    const symbolMatch = c.symbolName && queryLower.includes(c.symbolName.toLowerCase()) ? 0.15 : 0;
    const pathMatch = queryWords.some((w) => c.filePath.toLowerCase().includes(w)) ? 0.05 : 0;
    const rerankScore = 0.5 * c.vectorScore + 0.4 * normalizedBm25 + symbolMatch + pathMatch;
    return { ...c, rerankScore };
  });

  scored.sort((a, b) => b.rerankScore - a.rerankScore);
  return scored.slice(0, topK);
}
