// PRD §22 — the main dashboard. This is the placeholder version: it proves
// the full stack (web → api → RLS-scoped database) is wired end to end,
// which is the whole point of Phase 0/1 scaffolding. The real dashboard
// (§12 tiles: campaigns, delivery rates, quality, portfolio headroom) is
// Phase 6 work per §25.

// The web app and the API now run on separate hosts (Hostinger shared
// hosting for this app, a VPS for the API/webhook/workers/database) — see
// RUNBOOK.md "Split hosting". This is a real cross-origin HTTP call, not
// same-Docker-network traffic, so it goes over the API's public HTTPS
// endpoint behind Caddy.
const API_URL = process.env.API_BASE_URL ?? "http://localhost:8787";

async function getHealth() {
  try {
    const res = await fetch(`${API_URL}/health`, { cache: "no-store" });
    return await res.json();
  } catch (err) {
    return { status: "error", detail: String(err) };
  }
}

async function getDemoWorkspace() {
  try {
    const res = await fetch(`${API_URL}/clients/by-slug/cits-internal`, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function getContacts(clientId: string) {
  try {
    const res = await fetch(`${API_URL}/workspace/contacts`, {
      headers: { "x-client-id": clientId },
      cache: "no-store",
    });
    return await res.json();
  } catch (err) {
    return { error: String(err) };
  }
}

export default async function DashboardPage() {
  const health = await getHealth();
  const workspace = await getDemoWorkspace();
  const contacts = workspace ? await getContacts(workspace.id) : null;

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 720, margin: "0 auto" }}>
      <h1>CITS WhatsApp Communication Manager</h1>
      <p style={{ color: "#666" }}>
        Phase 0/1 scaffold — see <code>docs/PRD.md</code> for the full specification.
      </p>

      <section style={{ marginTop: "2rem", padding: "1rem", border: "1px solid #ddd", borderRadius: 8 }}>
        <h2>System status</h2>
        <StatusRow label="API" ok={health.status === "ok"} detail={JSON.stringify(health)} />
        <StatusRow label="Demo workspace" ok={!!workspace} detail={workspace ? `${workspace.name} (${workspace.status})` : "not found — run bun run db:seed"} />
        <StatusRow
          label="Contacts query through tenant-scoped RLS"
          ok={!!contacts && !contacts.error}
          detail={contacts ? `${contacts.count ?? 0} contact(s) visible to workspace ${workspace?.name}` : "n/a"}
        />
      </section>

      <section style={{ marginTop: "2rem", color: "#888", fontSize: 14 }}>
        <p>
          This page calls the API over plain HTTP (<code>{API_URL}</code>), which in turn queries Postgres through the
          same row-level-security path every real feature will use (see <code>packages/db/src/tenant.ts</code>).
        </p>
      </section>
    </main>
  );
}

function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: "0.5rem 0" }}>
      <span style={{ fontWeight: 700, color: ok ? "#1a7f37" : "#c00", width: 20 }}>{ok ? "OK" : "X"}</span>
      <div>
        <strong>{label}</strong>
        <div style={{ color: "#666", fontSize: 13 }}>{detail}</div>
      </div>
    </div>
  );
}
