import type { NextFunction, Request, Response } from "express";

type AsyncRouteHandler<Req extends Request = Request> = (req: Req, res: Response, next: NextFunction) => Promise<unknown>;

/** Express 4 does not catch rejected promises from async route/middleware
 * handlers -- an unhandled rejection crashes the whole process (this is the
 * exact bug class fixed once already for the chat generation call; every
 * async handler in this app has the same exposure, so every one of them
 * gets wrapped in this rather than patched one at a time as they're found
 * in production). */
export function asyncHandler<Req extends Request = Request>(fn: AsyncRouteHandler<Req>) {
  return (req: Req, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
