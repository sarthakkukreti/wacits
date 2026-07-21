# Local development runbook

This is Phase 0/1 scaffolding (see `docs/PRD.md` §25) — enough of the stack
to prove the architecture is wired correctly end to end. It is not the
product; most business logic is marked `TODO` with a pointer to the PRD
section that specifies it.

## Prerequisites

- Bun `1.3.14` (pinned in every Dockerfile; a close local version works for
  `bun install`/dev, but re-verify against the pin before a real deploy)
- PostgreSQL 16+ and a Redis-protocol server (Valkey in production; Redis is
  wire-compatible for local dev) both reachable at the URLs in `.env`

## One-time setup

```
cp .env.example .env               # then fill in real secrets before any Meta integration
bun install
createdb wacits_dev                # or point DATABASE_URL at an existing empty database
bun run db:generate                # generates SQL from packages/db/src/schema
bun run db:migrate                 # applies it (DM-19: hand-editable, committed, never edited post-apply)
bun run db:security-setup          # creates wacits_app / wacits_platform roles + RLS (DM-12/DM-20)
bun run db:seed                    # platform settings, Appendix A error codes, one demo workspace
```

## Running everything

```
bun run dev:api            # :8787
bun run dev:webhook         # :8788
bun run dev:click-redirect  # :8789
bun run dev:web             # :3000 — open this one in a browser
cd apps/workers && bun run dev:send &
cd apps/workers && bun run dev:import &
cd apps/workers && bun run dev:scheduler &
```

Or via Docker Compose (builds every image, pinned tags per TS-1):

```
docker compose up --build
```

## Verifying it worked

- `curl localhost:8787/health` → `{"status":"ok","db":"reachable"}`
- `curl localhost:8788/health` (webhook), `curl localhost:8789/health` (click-redirect)
- Open `http://localhost:3000` — the dashboard placeholder calls the API,
  resolves the seeded demo workspace, and queries its contacts through the
  RLS-scoped path (`packages/db/src/tenant.ts`). All three status rows
  should read OK.
- `cd packages/db && bun test` — runs the DM-20 tenant-isolation test:
  proves a workspace session can never read another workspace's contacts,
  even when the query itself does not filter by client.

## What is real vs. a placeholder here

**Real:** the full data model (`packages/db/src/schema`, all of PRD §21),
row-level security enforced in the database (not just application code),
the append-only/mutable table split, the Appendix A error-code seed, the
settings-as-data pattern, the BullMQ queue wiring with its two mandatory
config rules, and the webhook receiver's signature verification.

**Placeholder (see the `TODO` comments for the exact PRD reference):**
actual Meta API calls (no WABA is onboarded yet — see Appendix B), the
contact-import file parser, inbound-webhook business processing, click-link
token resolution (flagged as a genuine data-model gap to resolve, not
guessed at), and all authentication (Better Auth is specified but not
wired — the API currently trusts an `x-client-id` header, which is fine for
this scaffold and must not reach anything resembling production).
