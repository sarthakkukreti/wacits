import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 380 }}>
        <div className="card-head" style={{ display: "block", textAlign: "center" }}>
          <h2 style={{ marginBottom: 2 }}>CITS WhatsApp</h2>
          <span className="sub">Communication Manager</span>
        </div>
        <LoginForm from={from ?? "/"} />
      </div>
    </div>
  );
}
