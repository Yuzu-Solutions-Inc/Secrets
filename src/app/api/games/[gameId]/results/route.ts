import { NextResponse } from "next/server";

import { calculateFinalScore, winnerFormulaSchema } from "@/lib/game/rules";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const { gameId } = await params;
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("is_game_admin", { p_game_id: gameId });
  if (!allowed) return new NextResponse("Not found", { status: 404 });
  const [{ data: game }, { data: players }] = await Promise.all([
    supabase.from("games").select("title,settings").eq("id", gameId).single(),
    supabase
      .from("game_players")
      .select("id,profiles(display_name),wallets(balance),secret_holders(secrets(status)),mission_assignments(missions(status)),house_secret_submissions(result),ballots!target_player_id(kind)")
      .eq("game_id", gameId),
  ]);
  const settings = game?.settings as { winnerFormula?: unknown } | null;
  const formula = winnerFormulaSchema.parse(settings?.winnerFormula ?? {});
  const rows = (players ?? []).map((player) => {
    const profile = Array.isArray(player.profiles) ? player.profiles[0] : player.profiles;
    const wallet = Array.isArray(player.wallets) ? player.wallets[0] : player.wallets;
    const protectedSecret = player.secret_holders?.some((holder) => {
      const secret = Array.isArray(holder.secrets) ? holder.secrets[0] : holder.secrets;
      return secret?.status !== "revealed";
    }) ?? false;
    const missions = player.mission_assignments?.filter((assignment) => {
      const mission = Array.isArray(assignment.missions) ? assignment.missions[0] : assignment.missions;
      return mission?.status === "approved";
    }).length ?? 0;
    const houseSolved = player.house_secret_submissions?.some((submission) => submission.result === "correct") ?? false;
    const votes = player.ballots?.filter((ballot) => ballot.kind === "finale").length ?? 0;
    const balance = Number(wallet?.balance ?? 0);
    return {
      name: profile?.display_name ?? "Player",
      balance,
      protectedSecret,
      missions,
      houseSolved,
      votes,
      score: calculateFinalScore({
        balance,
        secretProtected: protectedSecret,
        houseSecretSolved: houseSolved,
        approvedMissions: missions,
        finaleVotes: votes,
      }, formula),
    };
  }).sort((a, b) => b.score - a.score);
  const escape = (value: unknown) => `"${String(value).replaceAll('"', '""')}"`;
  const csv = [
    ["Rank", "Player", "Score", "Balance", "Secret protected", "Missions", "House Secret", "Finale votes"],
    ...rows.map((row, index) => [index + 1, row.name, row.score, row.balance, row.protectedSecret, row.missions, row.houseSolved, row.votes]),
  ].map((row) => row.map(escape).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${String(game?.title ?? "secrets").replaceAll(/[^a-z0-9]+/gi, "-")}-results.csv"`,
    },
  });
}
