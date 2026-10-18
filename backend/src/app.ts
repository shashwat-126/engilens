import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth.js";
import { orgsRouter } from "./routes/orgs.js";
import { projectsRouter } from "./routes/projects.js";
import { documentsRouter } from "./routes/documents.js";
import { chatRouter } from "./routes/chat.js";
import { repositoriesRouter } from "./routes/repositories.js";
import { dependenciesRouter } from "./routes/dependencies.js";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/organizations", orgsRouter);
  app.use("/api/v1/projects", projectsRouter);
  app.use("/api/v1/projects/:projectId/documents", documentsRouter);
  app.use("/api/v1/projects/:projectId/chat", chatRouter);
  app.use("/api/v1/projects/:projectId/repositories", repositoriesRouter);
  app.use("/api/v1/projects/:projectId/dependencies", dependenciesRouter);

  app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }));

  // Centralized error handler -- catches anything a route handler throws
  // (e.g. a Postgres error) instead of letting Express's default handler
  // leak stack traces, and keeps the process alive.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[unhandled route error]", err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
