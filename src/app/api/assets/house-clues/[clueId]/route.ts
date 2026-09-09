import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ clueId: string }> },
) {
  const { clueId } = await params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return new NextResponse("Unauthorized", { status: 401 });

  // RLS returns this clue only once it is released to a player of its house
  // secret, or to a game admin.
  const { data: clue } = await supabase
    .from("house_secret_clues")
    .select("asset_path")
    .eq("id", clueId)
    .maybeSingle();
  if (!clue?.asset_path) return new NextResponse("Not found", { status: 404 });
  const { data, error } = await createAdminClient().storage
    .from("game-assets")
    .download(clue.asset_path);
  if (error) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(data, {
    headers: {
      "Content-Type": data.type || "application/octet-stream",
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
