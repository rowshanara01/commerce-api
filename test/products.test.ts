import { describe, expect, it } from "vitest";
import { admin, bearer, customer, product, setup } from "./helpers.js";

describe("products", () => {
  it("RBAC: customer 403, token chhara 401, admin 201; duplicate sku 409", async () => {
    const { api } = setup();
    const body = { sku: "ABC-1", name: "Phone", priceCents: 5000, stock: 3 };
    expect((await api.post("/products").send(body)).status).toBe(401);
    const c = await customer(api, "c@test.io");
    expect((await api.post("/products").set(bearer(c.accessToken)).send(body)).status).toBe(403);
    const a = await admin(api);
    expect((await api.post("/products").set(bearer(a.accessToken)).send(body)).status).toBe(201);
    expect((await api.post("/products").set(bearer(a.accessToken)).send(body)).status).toBe(409);
  });

  it("validation: negative price, float price (money integer cents), bad sku", async () => {
    const { api } = setup();
    const a = (await admin(api)).accessToken;
    for (const bad of [{ priceCents: -1 }, { priceCents: 10.5 }, { sku: "has space" }, { stock: -5 }]) {
      const r = await api.post("/products").set(bearer(a)).send({ sku: "OK-1", name: "x", priceCents: 100, stock: 1, ...bad });
      expect(r.status).toBe(400);
    }
  });

  it("pagination meta, sort, price filter", async () => {
    const { api } = setup();
    const a = (await admin(api)).accessToken;
    for (let i = 1; i <= 25; i++) await product(api, a, { name: `Item ${i}`, priceCents: i * 100 });
    const p1 = await api.get("/products?limit=10&page=1&sort=price&order=asc");
    expect(p1.body.meta).toEqual({ page: 1, limit: 10, total: 25, totalPages: 3 });
    expect(p1.body.data.map((p: { priceCents: number }) => p.priceCents)).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    const p3 = await api.get("/products?limit=10&page=3&sort=price&order=asc");
    expect(p3.body.data).toHaveLength(5);
    expect((await api.get("/products?minPrice=2000&maxPrice=2200")).body.meta.total).toBe(3);
    expect((await api.get("/products?limit=101")).status).toBe(400);   // limit er upore keu 1M row chaite parbe na
  });

  it("SQL injection: sort whitelist + parameterized query, LIKE wildcard escape", async () => {
    const { api, db } = setup();
    const a = (await admin(api)).accessToken;
    await product(api, a, { name: "Phone" });
    await product(api, a, { name: "100% Cotton Shirt" });
    expect((await api.get("/products").query({ sort: "price; DROP TABLE products" })).status).toBe(400);
    expect((await api.get("/products").query({ q: "' OR 1=1 --" })).body.data).toHaveLength(0);
    expect((await api.get("/products").query({ q: "%" })).body.data).toHaveLength(1);   // % wildcard na, literal
    expect((db.prepare("SELECT COUNT(*) n FROM products").get() as { n: number }).n).toBe(2);
  });

  it("soft delete: list/get e ashe na, order kora jay na", async () => {
    const { api } = setup();
    const a = (await admin(api)).accessToken;
    const c = (await customer(api, "c@test.io")).accessToken;
    const p = await product(api, a);
    expect((await api.delete(`/products/${p.id}`).set(bearer(a))).status).toBe(204);
    expect((await api.get(`/products/${p.id}`)).status).toBe(404);
    expect((await api.get("/products")).body.data).toHaveLength(0);
    const o = await api.post("/orders").set(bearer(c)).set("Idempotency-Key", "key-del-12345").send({ items: [{ productId: p.id, quantity: 1 }] });
    expect(o.status).toBe(422);
  });

  it("PATCH shudhu admin, 404 ar empty body 400", async () => {
    const { api } = setup();
    const a = (await admin(api)).accessToken;
    const p = await product(api, a);
    await api.patch(`/products/${p.id}`).set(bearer(a)).send({ description: "Original description" });
    const up = await api.patch(`/products/${p.id}`).set(bearer(a)).send({ priceCents: 777 });
    expect(up.body.priceCents).toBe(777);
    expect(up.body.description).toBe("Original description");   // partial update baki field nosto kore na
    expect((await api.patch(`/products/${p.id}`).set(bearer(a)).send({})).status).toBe(400);
    expect((await api.patch("/products/9999").set(bearer(a)).send({ stock: 1 })).status).toBe(404);
  });
});
