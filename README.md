# commerce-api: Production-style Backend (Node.js + TypeScript + Express)

Prai shob software company er backend er mul kathamo: **Auth + RBAC + CRUD + Order (transaction) + security**.
E-commerce, booking, SaaS, fintech: shob jaygay eki pattern.

## Chalanor niyom (Node 22.13+)
npm install
npm test                 # 28ta test
npm run dev              # http://localhost:3000   (DB: in-memory, na hole DB_PATH=./data.db)
# Production-like:
cp .env.example .env     # JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD thik koro
npm run build && npm start
docker build -t commerce-api . && docker run -p 3000:3000 -e JWT_SECRET=$(openssl rand -hex 32) commerce-api

## Endpoints
| Method | Path | Access |
|---|---|---|
| POST | /auth/register, /auth/login, /auth/refresh, /auth/logout | public |
| GET | /auth/me | login |
| GET | /products?q=&minPrice=&maxPrice=&sort=&order=&page=&limit= | public |
| GET | /products/:id | public |
| POST/PATCH/DELETE | /products(/:id) | admin |
| POST | /orders  (Idempotency-Key header lagbe) | login |
| GET | /orders, /orders/:id | owner / admin |
| POST | /orders/:id/cancel | owner / admin |
| PATCH | /orders/:id/status | admin |
| GET | /health | public |

## Ja ja ache (company te ja ja dekhte chay)
**Auth & Security**
- Password: bcrypt; JWT access (15 min) + refresh token (DB te shudhu hash), **rotation + reuse detection**
- JWT algorithm pin (alg:none attack), user enumeration/timing attack ruddho, mass assignment ruddho (register e role dewa jay na)
- RBAC (customer/admin), **IDOR protection** (onner order e 404)
- Rate limit: global + login brute-force (ip+email), Retry-After header
- helmet, body size limit, SQL injection (parameterized + sort whitelist + LIKE escape), production e weak JWT_SECRET e boot fail

**Data correctness**
- Money integer cents (float na), DB level CHECK (stock >= 0), versioned migrations
- Order = **ek transaction** (atomic), stock atomic conditional update (**oversell hoy na**: 20 parallel order, stock 5 -> thik 5ta success)
- **Idempotency-Key**: network retry e duplicate order/duplicate charge hoy na
- Order state machine (placed -> paid -> shipped, cancel stock ferot dey, double cancel safe)
- Soft delete, price snapshot (pore dam bodlale purono order bodlay na)

**Operability**
- Structured JSON log + request id (X-Request-Id), consistent error format, /health (DB check)
- Graceful shutdown (SIGTERM), Dockerfile (multi-stage, non-root, healthcheck), CI (typecheck + test + audit)

## Shimabodhdhota (sotti kotha)
- Rate limiter in-memory: ekadhik server hole Redis lage.
- SQLite ekta server er jonno bhalo; boro scale e PostgreSQL (same SQL prai, transaction er concept same).
- Payment gateway, email verification, password reset ei project e nai.
- node:sqlite Node e ekhono "experimental" (production e better-sqlite3 ba PostgreSQL use koro).

## Challenge
1. PostgreSQL e move koro (pg + SELECT ... FOR UPDATE ba same conditional update)
2. Redis rate limiter + refresh token blacklist
3. Payment webhook: signature verify + idempotent processing
4. Email verification + password reset (token, expiry)
5. OpenAPI/Swagger doc generate koro (zod-to-openapi)
6. Prometheus /metrics, OpenTelemetry tracing
7. Cursor pagination (offset boro page e dhire)
