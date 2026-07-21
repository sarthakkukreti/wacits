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

Or via Docker Compose, with everything published to the host for direct
access (builds every image, pinned tags per TS-1):

```
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

`docker-compose.dev.yml` is what republishes Postgres/Valkey/API/webhook/
click-redirect/web ports for local poking-around. The base
`docker-compose.yml` on its own is the production shape — see below — and
does not expose any of those directly.

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

## Production deployment (e.g. wacits.cyberlative.com)

The base `docker-compose.yml` is written for exactly this: one process per
container (§4.1), and **Caddy is the only service that publishes a port to
the host** (80/443). Postgres, Valkey, the API, the webhook receiver,
click-redirect and the web app are reachable only on the internal Docker
network. Caddy terminates TLS and routes by path under the one subdomain
that's been provisioned (see `Caddyfile`).

**Before running this on the server:**

1. **DNS.** `wacits.cyberlative.com` must have an A/AAAA record pointing at
   the server's public IP. If the DNS is managed through Cloudflare, use
   "DNS only" (grey cloud) rather than proxied (orange cloud) — Caddy needs
   to complete an HTTP-01 challenge on port 80 directly, which a proxying
   CDN in front of it will break. (DNS-01 via a Cloudflare API token is the
   alternative if the proxy has to stay on; not set up here.)

2. **Check nothing else already owns ports 80/443 on that server.** If
   another nginx/Apache/Caddy is already running other Cyberlative sites on
   this box, Caddy will fail to bind. Either free the ports for this
   compose stack, or don't run the `caddy` service and instead add a vhost
   to the existing proxy that forwards to `web:3000` / `webhook:8788` /
   `click-redirect:8789` — ask if this is the situation and the Caddyfile's
   routing logic can be translated directly into an nginx `server` block.

3. **Real secrets.** Copy `.env.example` to `.env` **on the server** (never
   commit the real one) and fill in at minimum `POSTGRES_PASSWORD` (no
   default — compose refuses to start without it) and `WACITS_DOMAIN`
   (defaults to `wacits.cyberlative.com` in the example file already). Meta
   credentials (`META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`,
   `META_SYSTEM_USER_TOKEN`) go here too once you have them.

4. **Bring it up:**

   ```
   docker compose up -d --build
   docker compose ps          # everything should report healthy within ~30s
   docker compose logs -f caddy  # confirm the certificate was issued
   ```

5. **Point Meta at it.** In the App Dashboard → WhatsApp → Configuration:
   - Callback URL: `https://wacits.cyberlative.com/webhook`
   - Verify token: whatever you put in `META_WEBHOOK_VERIFY_TOKEN`

   Click-tracking links will resolve at
   `https://wacits.cyberlative.com/c/<token>` once that feature is built.
   Note this reuses the app's own domain rather than a dedicated one — a
   deliberate compromise since only one subdomain exists today (PRD §16
   would prefer a clean domain of its own for click-through reputation;
   revisit if that becomes a real concern).

6. **Persisting certificates.** Caddy's automatically-obtained certificate
   lives in the `caddy_data` named volume. Don't delete that volume
   casually — Let's Encrypt rate-limits repeated issuance for the same
   domain.

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
