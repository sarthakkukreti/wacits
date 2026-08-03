export default function Loading() {
  return (
    <div className="content flex" style={{ alignItems: "center", justifyContent: "center", minHeight: 240 }}>
      <span className="spinner" style={{ width: 22, height: 22 }} aria-label="Loading" />
    </div>
  );
}
