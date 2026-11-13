import { describe, expect, it } from "vitest";
import { admin, bearer, customer, idem, product, setup } from "./helpers.js";

const place = (api: ReturnType<typeof setup>["api"], token: string, items: object[], key = idem()) =>
  api.post("/orders").set(bearer(token)).set("Idempotency-Key", key).send({ items });

describe("orders", () => {
  it("total DB er dam theke hoy, client er pathano dam ignore (price tampering)", async () => {
    const { api } = setup();
    const a = (await admin(api)).accessToken;
    const c = (await customer(api, "c@test.io")).accessToken;
    const p = await product(api, a, { priceCents: 2500, stock: 10 });
    const r = await place(api, c, [{ productId: p.id, quantity: 3, priceCents: 1, unitPriceCents: 1 }]);
    expect(r.status).toBe(201);
    expect(r.body.totalCents).toBe(7500);
    expect(r.body.items[0].unitPriceCents).toBe(2500);
    expect((await api.get(`/products/${p.id}`)).body.stock).toBe(7);
  });

  it("token chhara 401; Idempotency-Key chhara 400", async () => {
    const { api } = setup();
    const c = (await customer(api, "c@test.io")).accessToken;
    expect((await api.post("/orders").send({ items: [] })).status).toBe(401);
    expect((await api.post("/orders").set(bearer(c)).send({ items: [{ productId: 1, quantity: 1 }] })).status).toBe(400);
  });

  it("ATOMIC: duita product er ekta fail korle kono stock kome na", async () => {
    const { api } = setup();
    const a = (await admin(api)).accessToken;
    const c = (await customer(api, "c@test.io")).accessToken;
    const p1 = await product(api, a, { stock: 5 });
    const p2 = await product(api, a, { stock: 1 });
    const r = await place(api, c, [{ productId: p1.id, quantity: 2 }, { productId: p2.id, quantity: 2 }]);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("insufficient_stock");
    expect(r.body.error.details).toMatchObject({ productId: p2.id, available: 1 });
    expect((await api.get(`/products/${p1.id}`)).body.stock).toBe(5);   // p1 er stock ferot ache
    expect((await api.get("/orders").set(bearer(c))).body.meta.total).toBe(0);
  });

  it("OVERSELL hoy na: stock 5, 20ta parallel order -> thik 5ta success", async () => {
    const { api } = setup();
    const a = (await admin(api)).accessToken;
    const c = (await customer(api, "c@test.io")).accessToken;
    const p = await product(api, a, { stock: 5 });
    const results = await Promise.all(Array.from({ length: 20 }, () => place(api, c, [{ productId: p.id, quantity: 1 }])));
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(5);
    expect(results.filter((r) => r.status === 409)).toHaveLength(15);
    expect((await api.get(`/products/${p.id}`)).body.stock).toBe(0);
  });

  it("IDEMPOTENCY: network retry e duplicate order hoy na; same key + onno body = 422", async () => {
    const { api } = setup();
    const a = (await admin(api)).accessToken;
    const c = (await customer(api, "c@test.io")).accessToken;
    const p = await product(api, a, { stock: 10 });
    const key = idem();
    const first = await place(api, c, [{ productId: p.id, quantity: 2 }], key);
    const retry = await place(api, c, [{ productId: p.id, quantity: 2 }], key);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.headers["idempotent-replayed"]).toBe("true");
    expect(retry.body.id).toBe(first.body.id);
    expect((await api.get(`/products/${p.id}`)).body.stock).toBe(8);        // ekbar-i kata hoyeche
    expect((await place(api, c, [{ productId: p.id, quantity: 5 }], key)).status).toBe(422);
  });

  it("IDOR: onner order dekha jay na (404), admin dekhte pare, list e shudhu nijer", async () => {
    const { api } = setup();
    const a = (await admin(api)).accessToken;
    const u1 = (await customer(api, "u1@test.io")).accessToken;
    const u2 = (await customer(api, "u2@test.io")).accessToken;
    const p = await product(api, a, { stock: 10 });
    const o = (await place(api, u1, [{ productId: p.id, quantity: 1 }])).body;
    expect((await api.get(`/orders/${o.id}`).set(bearer(u2))).status).toBe(404);
    expect((await api.post(`/orders/${o.id}/cancel`).set(bearer(u2))).status).toBe(404);
    expect((await api.get(`/orders/${o.id}`).set(bearer(u1))).status).toBe(200);
    expect((await api.get(`/orders/${o.id}`).set(bearer(a))).status).toBe(200);
    expect((await api.get("/orders").set(bearer(u2))).body.meta.total).toBe(0);
    expect((await api.get("/orders").set(bearer(a))).body.meta.total).toBe(1);
  });

  it("cancel stock ferot dey; state machine: shipped/cancelled abar cancel kora jay na", async () => {
    const { api } = setup();
    const a = (await admin(api)).accessToken;
    const c = (await customer(api, "c@test.io")).accessToken;
    const p = await product(api, a, { stock: 4 });
    const o = (await place(api, c, [{ productId: p.id, quantity: 3 }])).body;
    expect((await api.get(`/products/${p.id}`)).body.stock).toBe(1);
    expect((await api.post(`/orders/${o.id}/cancel`).set(bearer(c))).body.status).toBe("cancelled");
    expect((await api.get(`/products/${p.id}`)).body.stock).toBe(4);
    expect((await api.post(`/orders/${o.id}/cancel`).set(bearer(c))).status).toBe(409);   // double cancel e double stock ferot hoy na
    expect((await api.get(`/products/${p.id}`)).body.stock).toBe(4);

    const o2 = (await place(api, c, [{ productId: p.id, quantity: 1 }])).body;
    expect((await api.patch(`/orders/${o2.id}/status`).set(bearer(a)).send({ status: "shipped" })).status).toBe(409);  // placed -> shipped valid na
    expect((await api.patch(`/orders/${o2.id}/status`).set(bearer(c)).send({ status: "paid" })).status).toBe(403);
    expect((await api.patch(`/orders/${o2.id}/status`).set(bearer(a)).send({ status: "paid" })).body.status).toBe("paid");
    expect((await api.patch(`/orders/${o2.id}/status`).set(bearer(a)).send({ status: "shipped" })).body.status).toBe("shipped");
    expect((await api.post(`/orders/${o2.id}/cancel`).set(bearer(c))).status).toBe(409);
  });

  it("same product duplicate line merge hoy; purono order er dam product dam bodlale bodlay na", async () => {
    const { api } = setup();
    const a = (await admin(api)).accessToken;
    const c = (await customer(api, "c@test.io")).accessToken;
    const p = await product(api, a, { priceCents: 1000, stock: 10 });
    const o = (await place(api, c, [{ productId: p.id, quantity: 1 }, { productId: p.id, quantity: 2 }])).body;
    expect(o.items).toEqual([{ productId: p.id, quantity: 3, unitPriceCents: 1000 }]);
    await api.patch(`/products/${p.id}`).set(bearer(a)).send({ priceCents: 9999 });
    expect((await api.get(`/orders/${o.id}`).set(bearer(c))).body.totalCents).toBe(3000);
  });
});
