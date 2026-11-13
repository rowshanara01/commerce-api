import cors from "cors";
import express from "express";
import helmet from "helmet";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { errorHandler, notFound } from "./errors.js";
import { authenticate, rateLimit, requestContext } from "./middleware/common.js";
import { authRoutes } from "./routes/auth.js";
import { orderRoutes } from "./routes/orders.js";
import { productRoutes } from "./routes/products.js";

export function createApp({ db, config }: { db: Db; config: Config }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestContext(config));
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "100kb" }));
  app.use(rateLimit({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.max, key: (req) => req.ip ?? "unknown" }));

  app.get("/health", (_req, res) => {
    db.prepare("SELECT 1").get();       // DB je cholche seta-o check
    res.json({ status: "ok", uptime: Math.round(process.uptime()) });
  });

  // Login e alada kothin limit: brute force rukhte (ip + email onujayi)
  app.use("/auth/login", rateLimit({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.loginMax,
    key: (req) => `${req.ip}:${String(req.body?.email ?? "").toLowerCase()}` }));
  app.use("/auth", authRoutes(db, config));
  app.use("/products", productRoutes(db, config));
  app.use("/orders", authenticate(config.jwtSecret), orderRoutes(db));

  app.use(notFound);
  app.use(errorHandler(config.env === "production"));
  return app;
}
