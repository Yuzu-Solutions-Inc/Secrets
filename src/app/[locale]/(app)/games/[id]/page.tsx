import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { PlayerDashboard } from "@/components/game/player-dashboard";
import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function GamePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const user = await getUser();
  const supabase = await createClient();
  const { data: game } = await supabase
    .from("games")
    .select("id,title,status,format,currency_symbol,public_code,current_round_id,settings")
    .eq("id", id)
    .maybeSingle();
  if (!game || !user) notFound();

  const [{ data: players }, { data: currentPlayer }, { data: round }] =
    await Promise.all([
      supabase
        .from("game_players")
        .select("id,user_id,is_ready,play_status,profiles(display_name,avatar_path)")
        .eq("game_id", id),
      supabase
        .from("game_players")
        .select("id,is_ready")
        .eq("game_id", id)
        .eq("user_id", user.id)
        .maybeSingle(),
      game.current_round_id
        ? supabase
            .from("game_rounds")
            .select("id,title,kind,status,config,ends_at")
            .eq("id", game.current_round_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
  if (!currentPlayer) notFound();

  const [{ data: wallet }, { data: missions }, { data: hints }, { data: notes }, { data: teamMember }, { data: hintOffers }, { data: houseSecret }, { data: activeBuzzes }] =
    await Promise.all([
      supabase.from("wallets").select("id,balance").eq("player_id", currentPlayer.id).maybeSingle(),
      supabase
        .from("mission_assignments")
        .select("mission_id,submitted_at,player_id,team_id,missions!inner(id,game_id,title,instructions,reward,penalty,status,deadline)")
        .eq("missions.game_id", id),
      supabase
        .from("hint_grants")
        .select("id,scope,source,hints(id,kind,text,asset_path,secret_id)")
        .eq("player_id", currentPlayer.id),
      supabase.from("theory_notes").select("id,body,target_player_id,updated_at").eq("player_id", currentPlayer.id),
      round
        ? supabase
            .from("team_members")
            .select("team_id,dilemma_choice,teams(id,name,color)")
            .eq("player_id", currentPlayer.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("hint_offers")
        .select("id,hint_id,price,status,seller:game_players!seller_player_id(profiles(display_name)),hints(text,kind)")
        .eq("buyer_player_id", currentPlayer.id)
        .eq("status", "pending"),
      supabase.rpc("house_secret_board", { p_game_id: id }),
      supabase
        .from("accusation_buzzes")
        .select("id,theory,stake,status,target:game_players!target_player_id(profiles(display_name))")
        .eq("accuser_player_id", currentPlayer.id)
        .in("status", ["pending", "confrontation", "confirmed"]),
    ]);

  return (
    <PlayerDashboard
      locale={locale}
      game={game}
      playerId={currentPlayer.id}
      players={(players ?? []).map((player) => ({
        ...player,
        profiles: Array.isArray(player.profiles)
          ? (player.profiles[0] ?? null)
          : player.profiles,
      }))}
      round={round}
      balance={Number(wallet?.balance ?? 0)}
      missions={missions ?? []}
      hints={hints ?? []}
      notes={notes ?? []}
      teamMember={teamMember}
      hintOffers={hintOffers ?? []}
      houseSecret={houseSecret && typeof houseSecret === "object" ? houseSecret as Record<string, unknown> : null}
      activeBuzzes={activeBuzzes ?? []}
    />
  );
}
