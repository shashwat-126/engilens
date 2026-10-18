import type { RetrievedChunk } from "./llm.js";

/** Heuristic faithfulness check: does the cited chunk actually share
 * meaningful token overlap with the answer text attributed to it?
 * A real system would use an NLI/entailment model or LLM-as-judge;
 * this keeps the pipeline dependency-free while still catching the
 * common failure mode of citing an irrelevant chunk. */
export function checkCitationSupport(answer: string, chunk: RetrievedChunk): boolean {
  const answerTokens = new Set(answer.toLowerCase().match(/[a-z0-9_]{4,}/g) ?? []);
  const chunkTokens = new Set(chunk.content.toLowerCase().match(/[a-z0-9_]{4,}/g) ?? []);
  if (answerTokens.size === 0 || chunkTokens.size === 0) return false;
  let overlap = 0;
  for (const t of answerTokens) if (chunkTokens.has(t)) overlap++;
  const coverage = overlap / Math.min(answerTokens.size, 12);
  return coverage >= 0.15;
}
