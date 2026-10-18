import { v4 as uuid } from "uuid";
import { pool, toVectorLiteral } from "./db.js";
import { chunkFile } from "./chunking.js";
import { embeddingProvider } from "./embeddings.js";
import { extractDependencyEdges, finalizeDependencyEdges } from "./dependencyGraph.js";

/** Runs inside the BullMQ worker (see queue.ts). Parses, chunks, embeds, and
 * stores a document's chunks, plus extracts any import/require edges for the
 * code dependency graph. */
export async function runIngestion(documentId: string): Promise<void> {
  const docResult = await pool.query<{ id: string; project_id: string; name: string; source: string }>(
    `SELECT id, project_id, name, source FROM documents WHERE id = $1`,
    [documentId]
  );
  const doc = docResult.rows[0];
  if (!doc) return;

  const client = await pool.connect();
  try {
    await client.query(`UPDATE documents SET status = 'PROCESSING', updated_at = now() WHERE id = $1`, [documentId]);

    const rawChunks = chunkFile(doc.name, doc.source);

    await client.query("BEGIN");
    for (let i = 0; i < rawChunks.length; i++) {
      const c = rawChunks[i];
      const embedding = embeddingProvider.embed(c.content);
      await client.query(
        `INSERT INTO chunks (id, document_id, project_id, content, chunk_index, file_path, start_line, end_line, language, symbol_name, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector)`,
        [
          uuid(),
          doc.id,
          doc.project_id,
          c.content,
          i,
          doc.name,
          c.startLine,
          c.endLine,
          c.language,
          c.symbolName,
          toVectorLiteral(embedding),
        ]
      );
    }

    // Dependency graph: extract import/require edges from this file's
    // source (not from individual chunks, so multi-chunk files still get
    // their full import list). Inserted with the best-effort resolved path;
    // finalizeDependencyEdges() below retries resolution against whatever's
    // been ingested so far, since a file can easily be ingested before the
    // files it imports.
    const rawEdges = extractDependencyEdges(doc.name, doc.source);
    for (const edge of rawEdges) {
      await client.query(
        `INSERT INTO dependency_edges (id, project_id, from_file, to_file, import_raw) VALUES ($1, $2, $3, $4, $5)`,
        [uuid(), doc.project_id, doc.name, edge.resolvedTo, edge.raw]
      );
    }

    await client.query("COMMIT");
    await client.query(`UPDATE documents SET status = 'COMPLETED', updated_at = now() WHERE id = $1`, [documentId]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    await pool.query(`UPDATE documents SET status = 'FAILED', error = $1, updated_at = now() WHERE id = $2`, [
      String(err),
      documentId,
    ]);
    throw err; // let BullMQ record the failure / retry
  } finally {
    client.release();
  }

  // Self-healing dependency resolution -- now that this file's edges (and
  // any previously-unresolved ones from other files) can be checked against
  // an up-to-date document set.
  await finalizeDependencyEdges(doc.project_id).catch((err) =>
    console.error("[ingestion] dependency edge finalize failed:", err)
  );
}
