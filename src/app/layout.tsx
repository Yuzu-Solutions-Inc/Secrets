import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Secrets", template: "%s · Secrets" },
  description: "A realtime party game of secrets, clues, missions and strategy.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
