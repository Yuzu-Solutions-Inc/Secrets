import { Settings2 } from "lucide-react";
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
  const { data: isAdmin } = await supabase.rpc("is_game_admin", { p_game_id: id });

  const [{ data: players }, { data: currentPlayer }, { data: round }] =
    await Promise.all([
      supabase
        .from("game_players")
        .select("id,user_id,is_ready,play_status,profiles(display_name,avatar_path)")
        .eq("game_id", id),
      supabase
        .from("game_players")
        .select("id,is_ready,user_id")
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

  const [{ data: wallet }, { data: missions }, { data: hints }, { data: notes }, { data: teamMember }, { data: hintOffers }, { data: houseSecret }, { data: activeBuzzes }, { data: vault }] =
    await Promise.all([
      supabase.from("wallets").select("id,balance").eq("player_id", currentPlayer.id).maybeSingle(),
      supabase
        .from("mission_assignments")
        .select("mission_id,submitted_at,seen_at,player_id,team_id,missions!inner(id,game_id,title,instructions,reward,penalty,status,deadline,started_at)")
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
      supabase.rpc("player_vault", { p_game_id: id }),
    ]);

  // Active broadcast dilemmas that target this player, plus their own answer.
  const { data: dilemmaEvents } = await supabase
    .from("game_events")
    .select("id,title,payload,published_at")
    .eq("game_id", id)
    .eq("kind", "dilemma")
    .order("published_at", { ascending: false })
    .limit(10);
  // The most recent public broadcast, for the 5s phone flash (item 23).
  const { data: latestBroadcastRow } = await supabase
    .from("game_events")
    .select("id,kind,title,body,published_at")
    .eq("game_id", id)
    .eq("is_public", true)
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const dilemmaIds = (dilemmaEvents ?? []).map((event) => event.id as string);
  const { data: myDilemmaResponses } = dilemmaIds.length
    ? await supabase.from("game_event_responses").select("game_event_id,choice").eq("player_id", currentPlayer.id).in("game_event_id", dilemmaIds)
    : { data: [] as { game_event_id: string; choice: string }[] };
  const myTeamId = (teamMember as { team_id?: string } | null)?.team_id ?? null;
  const dilemmas = (dilemmaEvents ?? [])
    .map((event) => {
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      const scope = String(payload.scope ?? "all");
      const targeted =
        scope === "all" ||
        (scope === "team" && myTeamId != null && String(payload.team_id) === myTeamId) ||
        (scope === "player" && String(payload.player_id) === currentPlayer.id);
      if (!targeted) return null;
      return {
        id: event.id as string,
        prompt: String(event.title ?? ""),
        option1: String(payload.option_1 ?? "Option 1"),
        option2: String(payload.option_2 ?? "Option 2"),
        myChoice: (myDilemmaResponses ?? []).find((response) => response.game_event_id === event.id)?.choice ?? null,
      };
    })
    .filter((dilemma): dilemma is NonNullable<typeof dilemma> => dilemma !== null);

  return (
    <>
      {isAdmin ? (
        <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between gap-4 rounded-2xl bg-pink-50 px-5 py-3">
          <p className="text-sm font-semibold text-pink-800">
            You&apos;re hosting this game.
          </p>
          <a
            href={`/${locale}/games/${id}/host`}
            className="pill pill-primary inline-flex items-center gap-2 text-sm"
          >
            <Settings2 size={16} /> Host controls
          </a>
        </div>
      ) : null}
      <PlayerDashboard
        locale={locale}
        game={game}
        playerId={currentPlayer.id}
        currentUserId={user.id}
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
        vault={vault && typeof vault === "object" ? vault as Record<string, unknown> : null}
        dilemmas={dilemmas}
        latestBroadcast={
          latestBroadcastRow
            ? {
                id: latestBroadcastRow.id as string,
                kind: String(latestBroadcastRow.kind ?? "announcement"),
                title: String(latestBroadcastRow.title ?? ""),
                body: latestBroadcastRow.body ? String(latestBroadcastRow.body) : null,
              }
            : null
        }
      />
    </>
  );
}
