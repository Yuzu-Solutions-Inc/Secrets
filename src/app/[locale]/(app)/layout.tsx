import { setRequestLocale } from "next-intl/server";

import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AuthenticatedLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireUser(locale);
  return <AppShell locale={locale}>{children}</AppShell>;
}
