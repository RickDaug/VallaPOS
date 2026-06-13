# VallaPOS

**Browser-based point of sale for mobile and local businesses** — food trucks, barbers, lawn care, mobile vendors, and small service shops.

> No hardware contract. No complicated setup. Open a browser and sell.

VallaPOS is an offline-capable PWA: the catalog, cart, cash payments, and receipts keep working when the network drops, then sync when you reconnect. It is multi-tenant from the ground up — each business's data is isolated — with real accounts and roles.

---

## Status

🏗️ **Rebuild in progress.** The original single-file prototype has been replaced with a real, restructured foundation (this commit). See [`STATE.md`](./STATE.md) for exactly where things stand — **read it before working on this repo.**

The product spec, architecture, and roadmap live in [`docs/`](./docs):

- [`docs/PRD.md`](./docs/PRD.md) — what we're building and for whom
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — how it's built and why
- [`docs/ROADMAP.md`](./docs/ROADMAP.md) — MVP → v1 → v2 sequencing

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router) + React + TypeScript |
| Styling | Tailwind CSS |
| Data | Prisma + PostgreSQL (Neon) |
| Auth | Better Auth (multi-tenant orgs + roles) |
| Offline | PWA via Serwist + IndexedDB queue |
| Hosting | Vercel (web) + Neon (database) |
| Payments | Cash/manual (v1) → Stripe Terminal + QR (later) |

Exact pinned versions live in [`package.json`](./package.json) — we **never** use `"latest"` (see [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md#dependency-policy)).

## Quick start

```bash
npm install
cp .env.example .env.local      # then fill in DATABASE_URL + auth secret
npx prisma migrate dev          # create the schema + run migrations
npx prisma db seed              # optional: demo business + catalog
npm run dev
```

Open <http://localhost:3000>.

## Product positioning

VallaPOS is for operators who do **not** want an enterprise POS. The wedge is mobile and local businesses that need fast checkout on any phone, tablet, or laptop browser — with inventory that's *optional*, first-class support for **services** (a haircut or a lawn-mow is a line item, not a SKU with stock), and genuinely working offline.
