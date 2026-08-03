"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

type ToastKind = "info" | "ok" | "warn" | "danger";
type Toast = { id: number; kind: ToastKind; message: string };
type ToastContextValue = { show: (message: string, kind?: ToastKind) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

/** Replaces ad hoc success/error messaging with a consistent, dismissible
 *  notification — call from any client component under <ToastProvider>
 *  (mounted once in app/layout.tsx). */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() must be called inside <ToastProvider>");
  return ctx;
}

const AUTO_DISMISS_MS = 5000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = ++idRef.current;
      setToasts((current) => [...current, { id, kind, message }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast notice-${t.kind}`} onClick={() => dismiss(t.id)}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
