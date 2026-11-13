import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { tx, type Db } from "../db.js";
import { AppError, parse } from "../errors.js";

const idParam = z.coerce.number().int().positive();
const createBody = z.object({
  items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(100) })).min(1).max(50),
});
const idemKey = z.string().min(8).max(64).regex(/^[\w-]+$/);
const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  userId: z.coerce.number().int().positive().optional(),
});
const statusBody = z.object({ status: z.enum(["paid", "shipped"]) });

// Order state machine: shudhu ei transition gulo-i valid
const ALLOWED: Record<string, string[]> = { placed: ["paid", "cancelled"], paid: ["shipped", "cancelled"], shipped: [], cancelled: [] };

interface O { id: number; user_id: number; status: string; total_cents: number; created_at: number }
interface Item { product_id: number; quantity: number; unit_price_cents: number }

export function orderRoutes(db: Db) {
  const r = Router();   // authenticate app.ts e already lagano ache

  const load = (id: number) => {
    const o = db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as O | undefined;
    if (!o) return undefined;
    const items = db.prepare("SELECT product_id, quantity, unit_price_cents FROM order_items WHERE order_id = ?").all(id) as unknown as Item[];
    return { id: o.id, userId: o.user_id, status: o.status, totalCents: o.total_cents, createdAt: o.created_at,
      items: items.map((i) => ({ productId: i.product_id, quantity: i.quantity, unitPriceCents: i.unit_price_cents })) };
  };
  // Onner order dekhte chaile 404 (403 na) dei, jeno order er existence-i leak na hoy (IDOR protection)
  const loadVisible = (id: number, user: { id: number; role: string }) => {
    const o = load(id);
    if (!o || (user.role !== "admin" && o.userId !== user.id)) throw new AppError(404, "not_found", "Order not found");
    return o;
  };

  r.post("/", (req, res) => {
    const key = parse(idemKey, req.header("idempotency-key"));
    const body = parse(createBody, req.body);
    const merged = new Map<number, number>();
    for (const it of body.items) merged.set(it.productId, (merged.get(it.productId) ?? 0) + it.quantity);
    const items = [...merged].map(([productId, quantity]) => ({ productId, quantity })).sort((a, b) => a.productId - b.productId);
    if (items.some((i) => i.quantity > 100)) throw new AppError(400, "validation_error", "Quantity per product too large");
    const hash = createHash("sha256").update(JSON.stringify(items)).digest("hex");
    const uid = req.user!.id;

    // Shob ek transaction e: kono ekta fail korle stock kome na (atomic)
    const { orderId, replay } = tx(db, () => {
      const existing = db.prepare("SELECT id, request_hash FROM orders WHERE user_id = ? AND idempotency_key = ?").get(uid, key) as { id: number; request_hash: string } | undefined;
      if (existing) {
        if (existing.request_hash !== hash) throw new AppError(422, "idempotency_key_reuse", "Idempotency-Key already used with a different request");
        return { orderId: existing.id, replay: true };   // network retry: notun order na, ager ta-i dei
      }
      let total = 0;
      const lines: { productId: number; quantity: number; price: number }[] = [];
      for (const it of items) {
        // Dam SERVER theke, client er pathano dam kokhono bishwas kori na
        const p = db.prepare("SELECT id, price_cents, stock FROM products WHERE id = ? AND deleted_at IS NULL").get(it.productId) as { id: number; price_cents: number; stock: number } | undefined;
        if (!p) throw new AppError(422, "product_unavailable", `Product ${it.productId} not available`);
        // Atomic conditional update: "check then update" na, ek statement e. Duto request ekshathe ashleo oversell hoy na.
        const upd = db.prepare("UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?").run(it.quantity, it.productId, it.quantity);
        if (Number(upd.changes) === 0) throw new AppError(409, "insufficient_stock", "Not enough stock", { productId: it.productId, requested: it.quantity, available: p.stock });
        total += p.price_cents * it.quantity;
        lines.push({ productId: it.productId, quantity: it.quantity, price: p.price_cents });
      }
      const info = db.prepare("INSERT INTO orders (user_id, status, total_cents, idempotency_key, request_hash, created_at) VALUES (?,?,?,?,?,?)").run(uid, "placed", total, key, hash, Date.now());
      const oid = Number(info.lastInsertRowid);
      const ins = db.prepare("INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES (?,?,?,?)");
      for (const l of lines) ins.run(oid, l.productId, l.quantity, l.price);
      return { orderId: oid, replay: false };
    });
    if (replay) res.setHeader("Idempotent-Replayed", "true");
    res.status(replay ? 200 : 201).json(load(orderId));
  });

  r.get("/", (req, res) => {
    const q = parse(listQuery, req.query);
    const user = req.user!;
    const uid = user.role === "admin" ? q.userId : user.id;      // customer shudhu nijer, admin jekono (filter soho)
    const where = uid ? "WHERE user_id = ?" : "";
    const args = uid ? [uid] : [];
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM orders ${where}`).get(...args) as { n: number }).n;
    const rows = db.prepare(`SELECT * FROM orders ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, q.limit, (q.page - 1) * q.limit) as unknown as O[];
    res.json({ data: rows.map((o) => ({ id: o.id, userId: o.user_id, status: o.status, totalCents: o.total_cents, createdAt: o.created_at })),
      meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) } });
  });

  r.get("/:id", (req, res) => res.json(loadVisible(parse(idParam, req.params["id"]), req.user!)));

  r.post("/:id/cancel", (req, res) => {
    const id = parse(idParam, req.params["id"]);
    const user = req.user!;
    const out = tx(db, () => {
      const o = loadVisible(id, user);
      if (!ALLOWED[o.status]!.includes("cancelled")) throw new AppError(409, "invalid_transition", `Cannot cancel an order that is ${o.status}`);
      for (const it of o.items) db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").run(it.quantity, it.productId);  // stock ferot
      db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(id);
      return load(id);
    });
    res.json(out);
  });

  r.patch("/:id/status", (req, res) => {
    if (req.user!.role !== "admin") throw new AppError(403, "forbidden", "Admin only");
    const id = parse(idParam, req.params["id"]);
    const { status } = parse(statusBody, req.body);
    const out = tx(db, () => {
      const o = load(id);
      if (!o) throw new AppError(404, "not_found", "Order not found");
      if (!ALLOWED[o.status]!.includes(status)) throw new AppError(409, "invalid_transition", `Cannot move ${o.status} -> ${status}`);
      db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, id);
      return load(id);
    });
    res.json(out);
  });

  return r;
}
