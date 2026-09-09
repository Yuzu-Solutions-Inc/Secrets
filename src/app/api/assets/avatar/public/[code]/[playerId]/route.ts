import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Public player avatar for the TV dashboard (`/display/[code]`), viewable by
// signed-out guests. `public_game_dashboard` already gates on game status and
// returns each player's `id` + `avatar_path`, so this route reuses it rather
// than exposing profiles directly.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string; playerId: string }> },
) {
  const { code, playerId } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("public_game_dashboard", { p_code: code });
  const dashboard = data as { players?: { id?: string; avatar_path?: string | null }[] } | null;
  const path = dashboard?.players?.find((player) => player.id === playerId)?.avatar_path;
  if (!path) return new NextResponse("Not found", { status: 404 });

  const { data: file, error } = await createAdminClient().storage
    .from("game-assets")
    .download(path);
  if (error || !file) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(file, {
    headers: {
      "Content-Type": file.type || "image/webp",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
