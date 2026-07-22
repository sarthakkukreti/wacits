"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncTemplatesAction } from "../app/templates/actions";

export function SyncTemplatesButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  const sync = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await syncTemplatesAction();
      if (result.ok) {
        setMessage({
          ok: true,
          text: `Synced ${result.total} template${result.total === 1 ? "" : "s"} (${result.created} new).`,
        });
        router.refresh();
      } else {
        setMessage({ ok: false, text: result.error });
      }
    });
  };

  return (
    <div className="flex gap-10" style={{ alignItems: "center" }}>
      {message && (
        <span className="small" style={{ color: message.ok ? "var(--ok)" : "var(--danger)", maxWidth: 380 }}>
          {message.text}
        </span>
      )}
      <button type="button" className="btn btn-primary" onClick={sync} disabled={pending}>
        {pending ? (
          <>
            <span className="spinner" /> Syncing…
          </>
        ) : (
          "Sync from Meta"
        )}
      </button>
    </div>
  );
}
