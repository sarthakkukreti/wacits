import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CITS WhatsApp Communication Manager",
  description: "Internal multi-client WhatsApp campaign and inbox platform (see docs/PRD.md)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
