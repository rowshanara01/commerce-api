import { Router } from "express";
import { z } from "zod";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { AppError, parse } from "../errors.js";
import { authenticate, requireRole } from "../middleware/common.js";
import { isUnique } from "./auth.js";

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  sort: z.enum(["price", "name", "created_at"]).default("created_at"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),   // max limit: keu 1 million row chaite parbe na
});
const idParam = z.coerce.number().int().positive();
const fields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000),
  priceCents: z.number().int().min(0).max(100_000_000),
  stock: z.number().int().min(0).max(1_000_000),
};
const createBody = z.object({ sku: z.string().regex(/^[A-Za-z0-9_-]{2,40}$/), ...fields, description: fields.description.default("") });
// PATCH schema alada, .default() chhara: nahole .partial() default boshiye dey ar PATCH e description mushe jay (Zod 4 e eta ghotechhilo)
const patchBody = z.object(fields).partial().refine((o) => Object.keys(o).length > 0, "At least one field required");

// Sort column WHITELIST: user input kokhono SQL e boshe na
const SORT_COL = { price: "price_cents", name: "name", created_at: "created_at" } as const;

interface P { id: number; sku: string; name: string; description: string; price_cents: number; stock: number; created_at: number }
const toProduct = (p: P) => ({ id: p.id, sku: p.sku, name: p.name, description: p.description, priceCents: p.price_cents, stock: p.stock, createdAt: p.created_at });

export function productRoutes(db: Db, cfg: Config) {
  const r = Router();
  const admin = [authenticate(cfg.jwtSecret), requireRole("admin")];

  r.get("/", (req, res) => {
    const q = parse(listQuery, req.query);
    const where = ["deleted_at IS NULL"];
    const args: (string | number)[] = [];
    if (q.q) {
      where.push("(name LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\')");
      const like = `%${q.q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;   // user er % _ ke wildcard hote dei na
      args.push(like, like);
    }
    if (q.minPrice !== undefined) { where.push("price_cents >= ?"); args.push(q.minPrice); }
    if (q.maxPrice !== undefined) { where.push("price_cents <= ?"); args.push(q.maxPrice); }
    const w = where.join(" AND ");
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM products WHERE ${w}`).get(...args) as { n: number }).n;
    const rows = db.prepare(`SELECT * FROM products WHERE ${w} ORDER BY ${SORT_COL[q.sort]} ${q.order === "asc" ? "ASC" : "DESC"}, id ASC LIMIT ? OFFSET ?`)
      .all(...args, q.limit, (q.page - 1) * q.limit) as unknown as P[];
    res.json({ data: rows.map(toProduct), meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) } });
  });

  r.get("/:id", (req, res) => {
    const id = parse(idParam, req.params["id"]);
    const p = db.prepare("SELECT * FROM products WHERE id = ? AND deleted_at IS NULL").get(id) as P | undefined;
    if (!p) throw new AppError(404, "not_found", "Product not found");
    res.json(toProduct(p));
  });

  r.post("/", ...admin, (req, res) => {
    const b = parse(createBody, req.body);
    try {
      const info = db.prepare("INSERT INTO products (sku, name, description, price_cents, stock, created_at) VALUES (?,?,?,?,?,?)")
        .run(b.sku, b.name, b.description, b.priceCents, b.stock, Date.now());
      const p = db.prepare("SELECT * FROM products WHERE id = ?").get(Number(info.lastInsertRowid)) as unknown as P;
      res.status(201).json(toProduct(p));
    } catch (e) {
      if (isUnique(e)) throw new AppError(409, "sku_taken", "SKU already exists");
      throw e;
    }
  });

  r.patch("/:id", ...admin, (req, res) => {
    const id = parse(idParam, req.params["id"]);
    const b = parse(patchBody, req.body);
    const cols: string[] = [];
    const args: (string | number)[] = [];
    const map = { name: "name", description: "description", priceCents: "price_cents", stock: "stock" } as const;
    for (const [k, col] of Object.entries(map)) {
      const v = (b as Record<string, string | number | undefined>)[k];
      if (v !== undefined) { cols.push(`${col} = ?`); args.push(v); }
    }
    const info = db.prepare(`UPDATE products SET ${cols.join(", ")} WHERE id = ? AND deleted_at IS NULL`).run(...args, id);
    if (Number(info.changes) === 0) throw new AppError(404, "not_found", "Product not found");
    res.json(toProduct(db.prepare("SELECT * FROM products WHERE id = ?").get(id) as unknown as P));
  });

  r.delete("/:id", ...admin, (req, res) => {
    const id = parse(idParam, req.params["id"]);
    // Soft delete: purono order gulo e product reference thake, tai row muchi na
    const info = db.prepare("UPDATE products SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL").run(Date.now(), id);
    if (Number(info.changes) === 0) throw new AppError(404, "not_found", "Product not found");
    res.status(204).end();
  });

  return r;
}
