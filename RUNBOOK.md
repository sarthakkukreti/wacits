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
cd apps/workers && bun run dev:webhook &   # turns raw webhooks into inbox messages
```

The web app reads the repo-root `.env` (see `apps/web/next.config.ts`), so
the same file configures every process locally. Two values must be set
before anything works: `API_SHARED_SECRET` (the credential the web app
presents to the API — generate with `openssl rand -hex 32`) and
`TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`).

Locally, `dev:web` still calls the API directly at `http://localhost:8787`
(`API_BASE_URL` in `.env`). In production the two run on different hosts
entirely — see "Split hosting" below.

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

## Split hosting: Hostinger (frontend) + VPS (backend)

The web app and everything else run on **different hosts** — Hostinger
shared hosting doesn't support Docker, Postgres, Valkey, Bun, or persistent
background workers, only a single Node.js app per domain (via Passenger).
So:

- **`wacits.cyberlative.com`** → Hostinger, serving just the Next.js
  dashboard (built standalone, uploaded as a plain Node.js app).
- **`api.wacits.cyberlative.com`** → the VPS, running everything else
  (Postgres, Valkey, API, webhook receiver, workers) behind Caddy.

### Backend (the VPS, managed by Coolify)

Coolify already runs its own Traefik proxy owning ports 80/443 for every
app on the box — this stack does **not** try to compete with that.
`docker-compose.yml`'s `caddy` service is an *internal* path-based router
(see `Caddyfile`) that listens on a plain `:80` inside the Docker network
and holds no certificate of its own. Coolify's Traefik is the actual
public HTTPS edge; it terminates TLS for `api.wacits.cyberlative.com` and
forwards plain HTTP to this `caddy` service, which then routes `/webhook`
→ the webhook receiver, `/c/*` → click-redirect, and everything else → the
API. The web app is **not** part of this compose file at all — it's on
Hostinger (see below).

**Important — do NOT use Coolify's per-service "Domain" field for this.**
It was tried first and rejected: for this Docker Compose resource type (at
least on this Coolify version), assigning a domain there makes Coolify
auto-inject `ports: - '80:80'` / `- '443:443'` onto the service — which
collides with Coolify's own Traefik already bound to those host ports
(`Bind for 0.0.0.0:80 failed: port is already allocated`). Confirmed by
inspecting the materialized compose file Coolify actually runs, at
`/data/coolify/applications/<uuid>/docker-compose.yaml` on the VPS via
Coolify's Terminal. The working pattern instead — reverse-engineered from
another Cyberlative project already running successfully on this same
VPS/Coolify instance, via `docker inspect <container> --format
'{{json .Config.Labels}}'` — is to hand-write Traefik labels directly onto
the `caddy` service in `docker-compose.yml` and join Coolify's shared
external `coolify` Docker network. Traefik then discovers the container
over that network by its labels; there is no host port publishing
involved at all. This is already done in `docker-compose.yml` — nothing
further to add there.

**Deploying it in Coolify:**

1. **DNS.** `api.wacits.cyberlative.com` needs its own A/AAAA record
   pointing at the VPS's IP — it cannot share a record with
   `wacits.cyberlative.com`, which points at Hostinger instead.

2. **New resource → Docker Compose**, pointed at this repo (Coolify can
   deploy directly from the GitHub repo and compose file — no need to hand
   it a raw compose paste). Coolify parses the services in
   `docker-compose.yml`. Enable **"Preserve Repository During
   Deployment"** in Configuration → General — without it, files referenced
   by bind mounts (like `./Caddyfile`) won't exist in Coolify's deployment
   directory and the `caddy` container will fail to start.

3. **Leave "Domains for caddy" (and every other service) EMPTY** in
   Coolify's UI. Routing is fully described by the Traefik labels already
   in `docker-compose.yml` — assigning a domain via Coolify's own field is
   what causes the port conflict described above.

4. **Environment variables**, set in Coolify's UI for this resource (this
   is effectively what `.env` holds locally): `POSTGRES_PASSWORD` (no
   default — the stack refuses to start without it), `CORS_ORIGIN`
   (`https://wacits.cyberlative.com` — the API rejects any other origin),
   plus Meta credentials once you have them. `API_PUBLIC_DOMAIN` is purely
   informational (see `.env.example`) — nothing reads it at runtime; the
   real hostname lives in the Traefik labels in `docker-compose.yml`.

5. **Deploy**, then confirm all services report healthy in Coolify's UI,
   and check the `caddy` service's logs for routing errors.

6. **Point Meta at it.** In the App Dashboard → WhatsApp → Configuration:
   - Callback URL: `https://api.wacits.cyberlative.com/webhook`
   - Verify token: whatever you set for `META_WEBHOOK_VERIFY_TOKEN`

   Click-tracking links resolve at
   `https://api.wacits.cyberlative.com/c/<token>` once that feature is
   built — on the backend domain rather than a dedicated one, a deliberate
   compromise since only these two subdomains exist today (PRD §16 would
   prefer a clean domain of its own for click-through reputation; revisit
   if that becomes a real concern).

**If this ever needs to run WITHOUT Coolify** (a plain VPS with nothing
else on it), the `caddy` service and `Caddyfile` would need to go back to
owning 80/443 directly and requesting its own certificate — that's the
shape this was originally built in; reverting the `expose`/`ports` and the
Caddyfile's `:80` back to a real domain-name site block is the whole
change. Not needed here since Coolify already exists on this VPS.

### Frontend (Hostinger)

Hostinger is connected to this GitHub repo and auto-deploys **`main`** on
push. It clones the repo, runs `npm install` at the root, then `npm run
build`, then `npm start`. Nothing about that sequence is configurable
enough to avoid, so the repo root has to satisfy it directly — hence the
`build` and `start` scripts in the root `package.json`, which are the only
npm entry points in an otherwise Bun-only repo.

**Why the backend packages say `"*"` and not `"workspace:*"`.** They used
the latter, and it broke every Hostinger deploy for three days:

```
npm error code EUNSUPPORTEDPROTOCOL
npm error Unsupported URL Type "workspace:": workspace:*
ERROR: Failed to install dependencies
```

`workspace:` is a Bun/pnpm protocol npm does not implement. npm reads the
root `package.json`, follows `"workspaces": ["apps/*", "packages/*"]` into
`apps/api` and `packages/db`, and dies there — even though the dashboard
itself depends on none of them. **Pointing Hostinger's root directory at
`apps/web` does not help**: npm walks *up* looking for a workspace root,
finds this one, and fails identically. Verified by running `npm install`
inside `apps/web` with the full repo present.

Plain `"*"` resolves to the same local package under both managers — a
dependency whose name matches a workspace member is linked from disk, and
`*` satisfies any version. Confirmed both ways: `bun install` still
symlinks `apps/api/node_modules/@wacits/db -> packages/db` and the backend
imports resolve, and `npm install` links `node_modules/@wacits/db ->
../../packages/db`. **Do not change these back to `workspace:*`** — it
gains nothing and re-breaks the frontend deploy.

`npm start` runs the standalone server directly rather than `next start`,
because `next.config.ts` sets `output: "standalone"` and Next refuses to
serve that (`"next start" does not work with "output: standalone"
configuration`). The root `build` script therefore also runs
`apps/web/scripts/prepare-standalone.sh`, which assembles that output and
writes the root `server.js` shim `npm start` launches. `apps/web`'s own
`start` prefers `$PORT` over `$WEB_PORT` so Hostinger's assigned port
wins.

A `.zip` is still available via `bun run package:hostinger`, and
`bun run deploy:hostinger` publishes the same prepared output to a
generated `hostinger-deploy` branch — both are fallbacks for hosts without
a working git integration, and neither is what this domain uses today.

**Verify any of these paths the same way before trusting it**: export the
tree into a directory that has never seen this repo, run `npm install &&
npm run build && npm start` with plain `node` (not Bun), hit every route,
and confirm a `/_next/static/...` asset returns 200 — a standalone build
that serves HTML but 404s its CSS is the classic failure here.

For the zip path, in Hostinger's hPanel:

1. **Websites → Add Website → Node.js Web App.**
2. **Framework: "Other"** (auto-detection will fail on a monorepo; this is
   expected — pick it manually rather than trying to fix detection).
3. **Node.js version:** 20.x, 22.x, or 24.x (Next.js 16 requires Node
   20.9+; **not** 18.x).
4. **Upload the zip.**
5. **Startup / entry file:** `server.js`. The real server is nested at
   `apps/web/server.js` because this app lives in a monorepo, but the
   packaging step also writes a one-line root shim that requires it, so
   the plain root path works and either value is correct. (The nested
   server does its own `process.chdir(__dirname)`, so requiring it from
   the root is safe.) The script prints the exact paths every time it
   runs, in case the structure ever changes.
6. **Environment variables:** `API_BASE_URL`
   (`https://api.wacits.cyberlative.com`), `API_SHARED_SECRET` (must match
   the API's own value — the dashboard renders server-side and
   authenticates with it, so every page fails to render without it), and
   `WORKSPACE_SLUG` (`cits-internal`). Whatever port Hostinger assigns is
   passed via its own `PORT` env var automatically — the packaged
   `server.js` already respects it.

**What the packaging script (`apps/web/scripts/package-standalone.sh`)
actually does, and why each step exists** — all three were found by
actually running the packaged output with plain `node` (not Bun) from a
different directory before trusting it, which is worth repeating after any
Next.js/Bun upgrade:

- **Copies `.next/static` and `public/` into the standalone app
  directory.** Next's standalone output doesn't include these
  automatically — documented Next.js behavior, not a bug.
- **Promotes Bun's hoisted `node_modules/.bun/node_modules/*` packages to
  the real top-level `node_modules/*`.** Next's file tracer preserves
  Bun's *internal* compatibility layer but not the *top-level* one plain
  Node.js actually walks up to find. Running the untouched build in place
  "works" only by accident — Node's resolution escapes the incomplete
  standalone folder and stumbles onto the real monorepo's root
  `node_modules` sitting right above it on disk. Move the folder anywhere
  else (a different directory, a zip, Hostinger) and that accident goes
  away: `server.js` throws `MODULE_NOT_FOUND` for `@swc/helpers` subpaths
  the instant it's relocated. This step recreates the structure plain
  Node.js expects, independent of location.
- **Strips `sharp` and `@img/*`, then verifies they're actually gone
  before zipping.** This app never uses `next/image`, but Next's tracer
  bundles `sharp` into the standalone output regardless of
  `images.unoptimized` or `outputFileTracingExcludes` (both were tried;
  neither stopped it). That matters because `sharp` ships prebuilt native
  binaries for whatever OS/arch it was built on — built on a Mac, those
  are darwin-arm64 and will not run on Hostinger's Linux server. The
  script fails loudly rather than ship a build with the wrong binary
  silently included.
- **Zips from inside the app directory**, so `server.js` sits at the zip's
  root — matching what a normal (non-monorepo) Next.js standalone build
  looks like, and what Hostinger's "startup file" field expects.

## What is real vs. a placeholder here

**Real and exercised end to end** (verified locally against Postgres, Valkey
and Meta's live API):

- The full data model (`packages/db/src/schema`, all of PRD §21) with
  row-level security enforced in the database, not just application code.
- **Contacts** — create/edit/archive, search and filter, E.164
  normalisation via libphonenumber-js, tags, contact types.
- **CSV import** (§9) — preview → column mapping → commit, with automatic
  header detection, per-row error reporting, in-file duplicate handling,
  fill-blanks-only updates, optional group creation, and the DM-28 24-hour
  undo that removes only what the import created.
- **Campaigns** (§12) — audience resolution from groups/tags/everyone with a
  live count, suppression applied and *counted* at snapshot time, outbox
  expansion, launch/pause/cancel, and a per-recipient delivery monitor.
- **Sending** (§13) — real Meta Cloud API calls. Errors are classified from
  `error_code_classification` by (api_surface, code) per DM-27, never a
  hardcoded switch: RETRY_BACKOFF retries, OPERATIONAL_ALERT pauses the
  campaign, 131050 writes to the global suppression list, 131026 accumulates
  strikes toward `suspect` per DM-22.
- **Inbox** (§14) — conversation list, threaded chat, one-to-one replies,
  starting a chat from a bare phone number, and the 24-hour customer service
  window enforced in both the API and the composer.
- **Inbound webhooks** — signature verification, durable raw capture, then
  asynchronous processing into conversations/messages/service windows, with
  delivery receipts applied by monotonic status rank (DM-7) and deduped on
  (wamid, status) (DM-11). Inbound opt-out keywords ("STOP") suppress
  immediately.
- **Templates** (§11) — synced from Meta with their live approval status;
  only APPROVED templates are offered to the campaign builder.
- Access tokens encrypted at rest (AES-256-GCM) and redacted from any error
  text before it is shown or logged.
- **Per-user login.** Email + password, gating the entire dashboard —
  anyone without a valid session is redirected to `/login` before any page
  or same-origin API route renders (`apps/web/middleware.ts` + a
  per-render `requireSession()` check in the root layout for the narrower
  "cookie present but expired" case). Hand-rolled, not the Better Auth
  library §6 originally specified (`packages/shared/src/password.ts`:
  scrypt + a `BETTER_AUTH_SECRET` pepper; `apps/api/src/routes/auth.ts`:
  login/logout/session/change-password; session tokens stored hashed, a
  Redis-backed login rate limiter that fails open) — reusing the schema
  and env var Better Auth's absence had already reserved, since running
  that library across this repo's split Hostinger/VPS hosts (the web app
  has no direct database access) was judged higher integration risk than
  it was worth for what is functionally plain email+password+session. One
  `superAdmin` account is seeded idempotently at API boot
  (`apps/api/src/lib/bootstrap-admin.ts`), the only way to get a user row
  into production given there's no shell access to run a one-off script
  there.

**Still placeholder or absent:**

- **Per-workspace role enforcement.** Login is binary — signed in or not —
  not §6's four workspace roles or §21.2's `user_client_role`/
  `user_client_permission` tables, which exist in the schema but are not
  yet read anywhere. Every dashboard action is still attributed to the one
  seeded operator account (`apps/api/src/lib/operator.ts`), not the actual
  signed-in user; wiring that through the ~12 call sites that write is a
  separate follow-up. No self-serve signup, invitations, or password reset
  (no email-sending capability exists in this repo) — additional users are
  a manual database insert for now.
- Click-link token resolution (a genuine data-model gap, deliberately not
  guessed at), scheduled campaigns, MM Lite, media messages in the composer,
  quiet hours, and the frequency governor.
- **There is no WhatsApp number validation and there never will be.** Meta's
  only contact-check endpoint (On-Premises `/contacts`) reached end-of-life
  on 2025-10-23 with no Cloud API replacement. Import validates *format*
  only; a number is proven reachable solely by a delivery receipt or an
  inbound reply, which is what the `deliverability_state` column records.
