import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { HostControlRoom } from "@/components/game/host-control-room";
import { createClient } from "@/lib/supabase/server";

export default async function HostPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_game_admin", {
    p_game_id: id,
  });
  if (!isAdmin) notFound();
  const { data: game } = await supabase
    .from("games")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!game) notFound();

  const [
    { data: players },
    { data: rounds },
    { data: buzzes },
    { data: missions },
    { data: events },
    { data: audit },
    { data: secrets },
    { data: houseSecret },
    { data: teams },
    { data: ledger },
  ] = await Promise.all([
    supabase.from("game_players").select("id,user_id,is_ready,play_status,profiles(display_name,email,avatar_path),wallets(balance)").eq("game_id", id),
    supabase.from("game_rounds").select("*").eq("game_id", id).order("position"),
    supabase.from("accusation_buzzes").select("*,accuser:game_players!accuser_player_id(profiles(display_name)),target:game_players!target_player_id(profiles(display_name))").eq("game_id", id).order("created_at", { ascending: false }),
    supabase.from("missions").select("*,mission_assignments(id,player_id,submitted_at,game_players(profiles(display_name)))").eq("game_id", id).order("created_at", { ascending: false }),
    supabase.from("game_events").select("*").eq("game_id", id).order("created_at", { ascending: false }).limit(20),
    supabase.from("audit_events").select("*").eq("game_id", id).order("created_at", { ascending: false }).limit(30),
    supabase.from("secrets").select("*,secret_holders(player_id,game_players(id,profiles(display_name))),hints(id,kind,text,position,default_price,released_at)").eq("game_id", id),
    supabase.from("house_secrets").select("*,house_secret_clues(*)").eq("game_id", id).maybeSingle(),
    supabase.from("teams").select("*,game_rounds!inner(game_id,title),team_members(player_id,game_players(profiles(display_name))),wallets(balance)").eq("game_rounds.game_id", id),
    supabase.from("ledger_transactions").select("id,type,description,created_at,reversed_transaction_id").eq("game_id", id).order("created_at", { ascending: false }).limit(30),
  ]);

  return (
    <HostControlRoom
      locale={locale}
      game={game}
      players={players ?? []}
      rounds={rounds ?? []}
      buzzes={buzzes ?? []}
      missions={missions ?? []}
      events={events ?? []}
      audit={audit ?? []}
      secrets={secrets ?? []}
      houseSecret={houseSecret}
      teams={teams ?? []}
      ledger={ledger ?? []}
    />
  );
}
