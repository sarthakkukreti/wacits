"use client";

import { useState } from "react";
import { Modal } from "./Modal";

/**
 * A confirm/cancel overlay for a single destructive or otherwise
 * consequential action, built on Modal so it gets the same focus trap and
 * Escape-to-close for free. Existing inline (swap-row-content) confirm
 * patterns elsewhere (LabelManager.tsx, ContactDetail.tsx) stay as they
 * are — this is for actions where an inline row isn't the right shape,
 * e.g. a destructive action triggered from outside a table row.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = "Confirm",
  danger = true,
  onConfirm,
  onClose,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} maxWidth={420}>
      <p className="mt-0">{body}</p>
      <div className="flex gap-6 mt-16">
        <button
          type="button"
          className={danger ? "btn btn-danger" : "btn btn-primary"}
          onClick={handleConfirm}
          disabled={pending}
        >
          {pending ? <span className="spinner" /> : confirmLabel}
        </button>
        <button type="button" className="btn" onClick={onClose} disabled={pending}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
