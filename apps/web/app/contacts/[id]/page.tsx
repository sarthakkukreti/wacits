import Link from "next/link";
import { apiSafe } from "../../../lib/api";
import { formatDateTime } from "../../../lib/format";
import { ContactDetail } from "../../../components/ContactDetail";

export const dynamic = "force-dynamic";

type Response = {
  contact: {
    id: string;
    phoneNumber: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    organization: string | null;
    designation: string | null;
    memberId: string | null;
    city: string | null;
    state: string | null;
    notes: string | null;
    deliverabilityState: string;
    marketingConsentState: string;
    strike131026Count: number;
    lifetimeMessageCount: number;
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
    createdAt: string;
    source: string | null;
  };
  tags: { id: string; name: string; color: string | null }[];
  consent: {
    id: string;
    direction: string;
    category: string;
    sourceType: string;
    sourceReference: string | null;
    occurredAt: string;
  }[];
  suppressed: { id: string; reason: string } | null;
};

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await apiSafe<Response>(`/workspace/contacts/${id}`);

  if (!result.ok) {
    return (
      <>
        <div className="topbar">
          <h1>Contact</h1>
        </div>
        <div className="content">
          <div className="notice notice-danger">
            <strong>Cannot load this contact</strong>
            {result.error}
          </div>
          <Link href="/contacts" className="btn">
            Back to contacts
          </Link>
        </div>
      </>
    );
  }

  const { contact: c, consent, suppressed } = result.data;
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.phoneNumber;

  return (
    <>
      <div className="topbar">
        <h1>{name}</h1>
        <div className="topbar-actions">
          <Link href="/contacts" className="btn">
            Back
          </Link>
        </div>
      </div>

      <div className="content">
        <div style={{ maxWidth: 900 }}>
          {suppressed && (
            <div className="notice notice-danger">
              <strong>On the opt-out (suppression) list</strong>
              {suppressed.reason} — campaigns will always skip this number until the opt-out is reversed.
            </div>
          )}

          <div className="grid grid-2 mb-16">
            <ContactDetail contact={c} />

            <div>
              <div className="card mb-16">
                <div className="card-head">
                  <h2>Activity</h2>
                </div>
                <div className="card-pad">
                  <table className="table">
                    <tbody>
                      <tr>
                        <td className="muted">Reachability</td>
                        <td className="text-right">
                          <span
                            className={`badge ${
                              c.deliverabilityState === "deliverable"
                                ? "badge-ok"
                                : c.deliverabilityState === "suspect"
                                  ? "badge-warn"
                                  : c.deliverabilityState === "invalid"
                                    ? "badge-danger"
                                    : "badge-muted"
                            }`}
                          >
                            {c.deliverabilityState === "unknown" ? "not yet contacted" : c.deliverabilityState}
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td className="muted">Messages exchanged</td>
                        <td className="text-right">{c.lifetimeMessageCount}</td>
                      </tr>
                      <tr>
                        <td className="muted">Last reply received</td>
                        <td className="text-right">{formatDateTime(c.lastInboundAt)}</td>
                      </tr>
                      <tr>
                        <td className="muted">Last message sent</td>
                        <td className="text-right">{formatDateTime(c.lastOutboundAt)}</td>
                      </tr>
                      {c.strike131026Count > 0 && (
                        <tr>
                          <td className="muted">Undeliverable strikes</td>
                          <td className="text-right">
                            <span className="badge badge-warn">{c.strike131026Count}</span>
                          </td>
                        </tr>
                      )}
                      <tr>
                        <td className="muted">Added</td>
                        <td className="text-right">{formatDateTime(c.createdAt)}</td>
                      </tr>
                      <tr>
                        <td className="muted">Source</td>
                        <td className="text-right faint">{c.source ?? "—"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <h2>Consent history</h2>
                  <span className="sub">Append-only</span>
                </div>
                {consent.length === 0 ? (
                  <div className="card-pad">
                    <p className="muted small mb-0">
                      No consent events recorded. Under §10 an opt-in should be evidenced before marketing messages are
                      sent.
                    </p>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <tbody>
                        {consent.map((r) => (
                          <tr key={r.id}>
                            <td>
                              <span className={`badge ${r.direction === "opt_in" ? "badge-ok" : "badge-danger"}`}>
                                {r.direction.replace("_", "-")}
                              </span>
                              <div className="faint small mt-8">{r.sourceType.replace(/_/g, " ")}</div>
                            </td>
                            <td className="text-right faint small">{formatDateTime(r.occurredAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
