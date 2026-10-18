// Usage: npm run evaluate -- <projectId>
// Reads evaluation/questions.json, runs hybrid retrieval + generation for each
// question against the given project, and reports the metrics described in
// the doc: Precision@K, Recall@K, MRR, and citation coverage.

import { readFileSync } from "node:fs";
import path from "node:path";
import { hybridSearch } from "../src/retrieval.js";
import { getLLMProvider } from "../src/llm.js";
import { checkCitationSupport } from "../src/citations.js";

interface EvalQuestion {
  question: string;
  expected_sources: string[];
}

const K = 5;

function precisionAtK(retrieved: string[], expected: string[]): number {
  if (retrieved.length === 0) return 0;
  const hits = retrieved.filter((f) => expected.includes(f)).length;
  return hits / retrieved.length;
}

function recallAtK(retrieved: string[], expected: string[]): number {
  if (expected.length === 0) return 1;
  const hits = expected.filter((f) => retrieved.includes(f)).length;
  return hits / expected.length;
}

function reciprocalRank(retrieved: string[], expected: string[]): number {
  for (let i = 0; i < retrieved.length; i++) {
    if (expected.includes(retrieved[i])) return 1 / (i + 1);
  }
  return 0;
}

async function main() {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error("Usage: npm run evaluate -- <projectId>");
    process.exit(1);
  }

  const questions: EvalQuestion[] = JSON.parse(
    readFileSync(path.join(process.cwd(), "evaluation", "questions.json"), "utf-8")
  );

  const llm = getLLMProvider();
  const rows: { question: string; precision: number; recall: number; rr: number; citationCoverage: number }[] = [];

  for (const q of questions) {
    const chunks = await hybridSearch(projectId, q.question, K);
    const retrievedFiles = [...new Set(chunks.map((c) => c.filePath))];

    const precision = precisionAtK(retrievedFiles, q.expected_sources);
    const recall = recallAtK(retrievedFiles, q.expected_sources);
    const rr = reciprocalRank(retrievedFiles, q.expected_sources);

    const answer = await llm.generateAnswer(q.question, chunks);
    const supportedCount = chunks.filter((c) => checkCitationSupport(answer, c)).length;
    const citationCoverage = chunks.length ? supportedCount / chunks.length : 0;

    rows.push({ question: q.question, precision, recall, rr, citationCoverage });
  }

  const avg = (key: keyof (typeof rows)[number]) =>
    rows.reduce((s, r) => s + (r[key] as number), 0) / rows.length;

  console.log("\nRAG Evaluation\n" + "-".repeat(40));
  for (const r of rows) {
    console.log(
      `${r.question}\n  Precision@${K}: ${r.precision.toFixed(2)}  Recall@${K}: ${r.recall.toFixed(
        2
      )}  RR: ${r.rr.toFixed(2)}  CitationCoverage: ${r.citationCoverage.toFixed(2)}`
    );
  }
  console.log("-".repeat(40));
  console.log(`Mean Precision@${K}:      ${avg("precision").toFixed(3)}`);
  console.log(`Mean Recall@${K}:         ${avg("recall").toFixed(3)}`);
  console.log(`MRR:                      ${avg("rr").toFixed(3)}`);
  console.log(`Mean Citation Coverage:   ${avg("citationCoverage").toFixed(3)}`);
  process.exit(0); // pg Pool keeps the event loop alive otherwise
}

main();
