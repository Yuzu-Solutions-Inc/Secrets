import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { PublicDisplay } from "@/components/game/public-display";
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
  const { data } = await supabase.rpc("public_game_dashboard", {
    p_code: code.toUpperCase(),
  });
  if (!data || typeof data !== "object") notFound();
  const dashboard = data as {
    game: Record<string, unknown>;
    players: Record<string, unknown>[];
    round: Record<string, unknown> | null;
    latest_event: Record<string, unknown> | null;
  };
  return (
    <PublicDisplay
      locale={locale}
      game={dashboard.game}
      players={dashboard.players ?? []}
      round={dashboard.round}
      latestEvent={dashboard.latest_event}
    />
  );
}
