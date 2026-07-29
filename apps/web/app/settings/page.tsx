import { apiSafe } from "../../lib/api";
import { SenderNumberForm } from "../../components/SenderNumberForm";
import { ChangePasswordForm } from "../../components/ChangePasswordForm";

export const dynamic = "force-dynamic";

type SenderNumber = {
  id: string;
  metaPhoneNumberId: string;
  displayPhoneNumber: string;
  displayName: string;
  qualityRating: string;
  registrationStatus: string;
  connectionStatus: string;
  wabaId: string | null;
  wabaName: string | null;
  hasToken: boolean;
};

export default async function SettingsPage() {
  const result = await apiSafe<{ senderNumbers: SenderNumber[]; systemTokenConfigured: boolean }>(
    "/workspace/settings/sender-numbers",
  );

  return (
    <>
      <div className="topbar">
        <h1>Settings</h1>
      </div>

      <div className="content">
        <div style={{ maxWidth: 780 }}>
          <ChangePasswordForm />

          {!result.ok ? (
            <div className="notice notice-danger mt-16">
              <strong>Cannot load settings</strong>
              {result.error}
            </div>
          ) : (
            <>
              <div className="card mb-16">
                <div className="card-head">
                  <h2>WhatsApp sender numbers</h2>
                  <span className="sub">The numbers messages are sent from</span>
                </div>

                {result.data.senderNumbers.length === 0 ? (
                  <div className="card-pad">
                    <div className="notice notice-warn mb-0">
                      <strong>No sender number connected</strong>
                      Nothing can be sent or received until you add the number you registered in Meta. Add it below.
                    </div>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Number</th>
                          <th>Quality</th>
                          <th>Connection</th>
                          <th>Credential</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.data.senderNumbers.map((n) => (
                          <tr key={n.id}>
                            <td>
                              <strong>{n.displayName}</strong>
                              <div className="faint mono small">{n.displayPhoneNumber}</div>
                              <div className="faint small">WABA {n.wabaId}</div>
                            </td>
                            <td>
                              <span
                                className={`badge ${
                                  n.qualityRating === "green"
                                    ? "badge-ok"
                                    : n.qualityRating === "yellow"
                                      ? "badge-warn"
                                      : n.qualityRating === "red"
                                        ? "badge-danger"
                                        : "badge-muted"
                                }`}
                              >
                                {n.qualityRating}
                              </span>
                            </td>
                            <td>
                              <span className={`badge ${n.connectionStatus === "connected" ? "badge-ok" : "badge-danger"}`}>
                                {n.connectionStatus}
                              </span>
                            </td>
                            <td>
                              {n.hasToken ? (
                                <span className="badge badge-ok">stored</span>
                              ) : result.data.systemTokenConfigured ? (
                                <span className="badge badge-info">using system token</span>
                              ) : (
                                <span className="badge badge-danger">missing</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <SenderNumberForm hasExisting={result.data.senderNumbers.length > 0} />

              <div className="card mt-16">
                <div className="card-head">
                  <h2>Webhook</h2>
                </div>
                <div className="card-pad">
                  <p className="muted small">
                    Meta must be pointed at this deployment&apos;s webhook so replies and delivery receipts arrive. In
                    the Meta app dashboard, under WhatsApp → Configuration:
                  </p>
                  <table className="table">
                    <tbody>
                      <tr>
                        <td className="muted">Callback URL</td>
                        <td className="mono">https://api.wacits.cyberlative.com/webhook</td>
                      </tr>
                      <tr>
                        <td className="muted">Verify token</td>
                        <td className="faint small">
                          The value of <code>META_WEBHOOK_VERIFY_TOKEN</code> on the server
                        </td>
                      </tr>
                      <tr>
                        <td className="muted">Required field</td>
                        <td>
                          <span className="badge badge-info mono">messages</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
