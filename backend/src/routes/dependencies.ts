import { Router } from "express";
import { authenticate, authorize } from "../rbac.js";
import { getDependencyNeighbors, getFullDependencyGraph } from "../dependencyGraph.js";
import { asyncHandler } from "../asyncHandler.js";

export const dependenciesRouter = Router({ mergeParams: true });
dependenciesRouter.use(authenticate);

/** "What does src/auth/jwt.service.ts depend on, and what depends on it" */
dependenciesRouter.get(
  "/",
  authorize("VIEWER"),
  asyncHandler(async (req, res) => {
    const file = req.query.file;
    if (typeof file !== "string" || !file) {
      return res.status(400).json({ error: "Provide ?file=<path> to look up its dependency neighbors" });
    }
    res.json(await getDependencyNeighbors(req.params.projectId, file));
  })
);

/** Full project dependency graph, for the frontend's graph view. */
dependenciesRouter.get(
  "/graph",
  authorize("VIEWER"),
  asyncHandler(async (req, res) => {
    res.json(await getFullDependencyGraph(req.params.projectId));
  })
);
