import type { Metadata } from "next";

import "./globals.css";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const description =
  "A realtime party game of secrets, clues, missions and strategy.";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  applicationName: "Secrets",
  title: { default: "Secrets", template: "%s · Secrets" },
  description,
  openGraph: {
    type: "website",
    siteName: "Secrets",
    title: "Secrets",
    description,
  },
  twitter: {
    card: "summary_large_image",
    title: "Secrets",
    description,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
