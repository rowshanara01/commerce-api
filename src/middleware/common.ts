import { randomUUID } from "node:crypto";
import type { Request, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { AppError } from "../errors.js";
import type { Config } from "../config.js";

/** Prottek request er ekta id (log + error response e), JSON structured log */
export function requestContext(cfg: Config): RequestHandler {
  return (req, res, next) => {
    const incoming = req.header("x-request-id");
    req.requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      if (!cfg.logRequests) return;
      console.log(JSON.stringify({ level: "info", requestId: req.requestId, method: req.method, path: req.path, status: res.statusCode,
        ms: Number(process.hrtime.bigint() - start) / 1e6, userId: req.user?.id }));
    });
    next();
  };
}

/** Fixed-window rate limiter (in-memory). Multi-server hole Redis lage (README te challenge). */
export function rateLimit(opts: { windowMs: number; max: number; key: (req: Request) => string }): RequestHandler {
  const hits = new Map<string, { count: number; reset: number }>();
  return (req, res, next) => {
    const now = Date.now();
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);   // memory bhore na jay
    const key = opts.key(req);
    let e = hits.get(key);
    if (!e || e.reset <= now) {
      e = { count: 0, reset: now + opts.windowMs };
      hits.set(key, e);
    }
    e.count++;
    res.setHeader("X-RateLimit-Limit", String(opts.max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, opts.max - e.count)));
    if (e.count > opts.max) {
      res.setHeader("Retry-After", String(Math.ceil((e.reset - now) / 1000)));
      throw new AppError(429, "rate_limited", "Too many requests, slow down");
    }
    next();
  };
}

export const authenticate = (secret: string): RequestHandler => (req, _res, next) => {
  const h = req.header("authorization");
  if (!h?.startsWith("Bearer ")) throw new AppError(401, "unauthorized", "Missing bearer token");
  try {
    // algorithms pin kora: "alg: none" attack ba vul algorithm ghotbe na
    const p = jwt.verify(h.slice(7), secret, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    req.user = { id: Number(p.sub), role: p["role"] === "admin" ? "admin" : "customer" };
    next();
  } catch {
    throw new AppError(401, "invalid_token", "Invalid or expired token");
  }
};

export const requireRole = (...roles: Array<"customer" | "admin">): RequestHandler => (req, _res, next) => {
  if (!req.user) throw new AppError(401, "unauthorized", "Login required");
  if (!roles.includes(req.user.role)) throw new AppError(403, "forbidden", "You do not have permission");
  next();
};
