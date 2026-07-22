"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelCampaignAction, launchCampaignAction, pauseCampaignAction } from "../app/campaigns/actions";

/**
 * Launch is the irreversible step, so it asks for explicit confirmation
 * showing the real recipient count (§12 — the "you are about to message
 * N people" gate). Everything else is a single click.
 */
export function CampaignControls({
  id,
  state,
  recipientCount,
}: {
  id: string;
  state: string;
  recipientCount: number;
}) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error ?? "Something went wrong.");
      else {
        setConfirming(false);
        router.refresh();
      }
    });
  };

  const canLaunch = ["draft", "scheduled", "paused"].includes(state);
  const canPause = state === "running";
  const canCancel = !["completed", "cancelled", "failed"].includes(state);

  if (confirming) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.45)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          zIndex: 100,
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setConfirming(false);
        }}
      >
        <div className="card" style={{ maxWidth: 460, width: "100%" }}>
          <div className="card-head">
            <h2>Send this campaign?</h2>
          </div>
          <div className="card-pad">
            {error && <div className="notice notice-danger">{error}</div>}
            <p>
              This will send a WhatsApp message to{" "}
              <strong>{recipientCount.toLocaleString("en-IN")} people</strong>. Messages already sent cannot be
              recalled.
            </p>
            <p className="muted small">
              You can pause the campaign afterwards, which stops anything still queued, but not what has already gone
              out.
            </p>
            <div className="flex gap-6 mt-16">
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending}
                onClick={() => run(() => launchCampaignAction(id))}
              >
                {pending ? <span className="spinner" /> : `Send to ${recipientCount.toLocaleString("en-IN")} people`}
              </button>
              <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={pending}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-6" style={{ alignItems: "center" }}>
      {error && <span className="small" style={{ color: "var(--danger)" }}>{error}</span>}

      {canLaunch && (
        <button type="button" className="btn btn-primary" onClick={() => setConfirming(true)} disabled={pending}>
          {state === "paused" ? "Resume" : "Launch"}
        </button>
      )}

      {canPause && (
        <button type="button" className="btn" onClick={() => run(() => pauseCampaignAction(id))} disabled={pending}>
          Pause
        </button>
      )}

      {canCancel && (
        <button type="button" className="btn" onClick={() => run(() => cancelCampaignAction(id))} disabled={pending}>
          Cancel campaign
        </button>
      )}
    </div>
  );
}
