import type { Metadata } from "next";
import { display, body, mono } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Redliner — second readings for contracts",
  description:
    "An LLM-powered second reading for NDAs. Upload a document, receive marginal notes from an attentive editor.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="paper min-h-screen antialiased">{children}</body>
    </html>
  );
}
