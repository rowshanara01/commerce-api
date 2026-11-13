import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError, type ZodTypeAny, type z } from "zod";

/** Expected (client) error. Prottek error ek format e jay: { error: { code, message, details } } */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new AppError(400, "validation_error", "Invalid request", r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return r.data;
}

export const notFound: RequestHandler = (req, _res, next) => next(new AppError(404, "not_found", `No route for ${req.method} ${req.path}`));

export const errorHandler = (isProd: boolean): ErrorRequestHandler => (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, requestId: req.requestId } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: "validation_error", message: "Invalid request", requestId: req.requestId } });
    return;
  }
  // body-parser errors (malformed JSON, too large)
  const status = typeof err?.status === "number" && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error(JSON.stringify({ level: "error", requestId: req.requestId, message: String(err?.message), stack: isProd ? undefined : err?.stack }));
  res.status(status).json({
    error: { code: status === 500 ? "internal_error" : "bad_request", message: status === 500 ? "Something went wrong" : String(err.message), requestId: req.requestId },
  });
};
