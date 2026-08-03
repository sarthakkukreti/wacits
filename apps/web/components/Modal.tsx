"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * The one sanctioned overlay-dialog primitive — real role="dialog",
 * aria-modal, a focus trap, and Escape-to-close. Every place in the app
 * that needs a modal should use this instead of hand-rolling another
 * position:fixed div (see AddContactDialog.tsx for the first migration).
 */
export function Modal({
  title,
  onClose,
  children,
  maxWidth = 520,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;

      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;

      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="card modal-panel"
        style={{ maxWidth }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
      >
        <div className="card-head">
          <h2 id="modal-title">{title}</h2>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close dialog">
            Close
          </button>
        </div>
        <div className="card-pad">{children}</div>
      </div>
    </div>
  );
}
