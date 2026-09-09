import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { PublicDisplay, type DashboardData } from "@/components/game/public-display";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DisplayPage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  const supabase = await createClient();
  const p_code = code.toUpperCase();
  const { data } = await supabase.rpc("public_game_dashboard", { p_code });
  if (!data || typeof data !== "object") notFound();
  return <PublicDisplay locale={locale} code={p_code} initialData={data as DashboardData} />;
}
