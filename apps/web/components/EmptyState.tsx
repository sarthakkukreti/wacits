/** Factors the `<div className="empty">` markup copy-pasted across every
 *  list page (campaigns, contacts, templates, messages, inbox) into one
 *  entry point. */
export function EmptyState({
  icon = "○",
  title,
  children,
}: {
  icon?: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden>
        {icon}
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
