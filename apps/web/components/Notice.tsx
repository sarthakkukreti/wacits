/** Factors the `<div className="notice notice-*">` markup copy-pasted
 *  across ~10 pages/components into one entry point. */
export function Notice({
  kind = "danger",
  title,
  children,
}: {
  kind?: "info" | "warn" | "danger" | "ok";
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`notice notice-${kind}`}>
      {title && <strong>{title}</strong>}
      {children}
    </div>
  );
}
