import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { pool } from "../db.js";
import { authenticate, authorize, type AuthedRequest } from "../rbac.js";
import { rateLimit } from "../rateLimit.js";
import { cacheGet, cacheKey, cacheSet } from "../cache.js";
import { hybridSearch } from "../retrieval.js";
import { getLLMProvider, listProviders } from "../llm.js";
import { checkCitationSupport } from "../citations.js";
import { asyncHandler } from "../asyncHandler.js";

export const chatRouter = Router({ mergeParams: true });
chatRouter.use(authenticate);

chatRouter.get("/providers", (_req, res) => {
  res.json(listProviders());
});

const askSchema = z.object({
  question: z.string().min(1),
  conversationId: z.string().optional(),
  provider: z.enum(["anthropic", "openai", "gemini", "mock"]).optional(),
  model: z.string().optional(),
});

chatRouter.post(
  "/",
  authorize("VIEWER"),
  rateLimit,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = askSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { question } = parsed.data;
    const projectId = req.params.projectId;

    let conversationId = parsed.data.conversationId;
    if (!conversationId) {
      conversationId = uuid();
      await pool.query(`INSERT INTO conversations (id, project_id, user_id, title) VALUES ($1, $2, $3, $4)`, [
        conversationId,
        projectId,
        req.user!.id,
        question.slice(0, 80),
      ]);
    }

    const userMsgId = uuid();
    await pool.query(`INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)`, [
      userMsgId,
      conversationId,
      question,
    ]);

    // ---- retrieval + generation (cached in Redis by project+question+provider+model) ----
    const llm = getLLMProvider({ provider: parsed.data.provider, model: parsed.data.model });
    const key = cacheKey([projectId, question.toLowerCase().trim(), llm.name, llm.model]);
    const cached = await cacheGet<{ answer: string; chunks: Awaited<ReturnType<typeof hybridSearch>> }>(key);

    let answer: string;
    let chunks: Awaited<ReturnType<typeof hybridSearch>>;
    let fromCache = false;

    if (cached) {
      ({ answer, chunks } = cached);
      fromCache = true;
    } else {
      chunks = await hybridSearch(projectId, question, 5);
      try {
        answer = await llm.generateAnswer(question, chunks);
      } catch (err) {
        // A provider call failing (bad key, deprecated model, network error,
        // rate limit) must not crash the process or drop the user's message --
        // surface it as a normal error response instead.
        console.error(`[chat] ${llm.name} generation failed:`, err);
        return res.status(502).json({
          error: `${llm.name} provider failed to generate an answer`,
          detail: err instanceof Error ? err.message : String(err),
          provider: llm.name,
          model: llm.model,
        });
      }
      await cacheSet(key, { answer, chunks });
    }

    const assistantMsgId = uuid();
    await pool.query(`INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, 'assistant', $3)`, [
      assistantMsgId,
      conversationId,
      answer,
    ]);

    const citations = await Promise.all(
      chunks.map(async (c) => {
        const supported = checkCitationSupport(answer, c);
        await pool.query(
          `INSERT INTO citations (id, message_id, chunk_id, file_path, start_line, end_line, supported) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [uuid(), assistantMsgId, c.id, c.filePath, c.startLine, c.endLine, supported]
        );
        return {
          filePath: c.filePath,
          startLine: c.startLine,
          endLine: c.endLine,
          relevance: c.score,
          supported,
        };
      })
    );

    res.json({
      conversationId,
      answer,
      citations,
      fromCache,
      provider: llm.name,
      model: llm.model,
    });
  })
);

chatRouter.get(
  "/:conversationId",
  authorize("VIEWER"),
  asyncHandler(async (req, res) => {
    // Scope by project, not just conversationId -- otherwise any VIEWER of
    // *any* project could read another project's conversation by guessing/
    // reusing a conversationId, since the RBAC check above only verifies
    // membership in the project named in the URL, not that this conversation
    // actually belongs to it.
    const conversation = await pool.query(`SELECT id FROM conversations WHERE id = $1 AND project_id = $2`, [
      req.params.conversationId,
      req.params.projectId,
    ]);
    if (conversation.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found in this project" });
    }

    const messages = await pool.query(
      `SELECT id, role, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [req.params.conversationId]
    );
    res.json(messages.rows);
  })
);
