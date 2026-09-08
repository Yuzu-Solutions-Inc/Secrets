import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hintId: string }> },
) {
  const { hintId } = await params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return new NextResponse("Unauthorized", { status: 401 });

  // RLS only returns this hint when the user owns a grant, belongs to its team,
  // can see the public grant, or administers the game.
  const { data: hint } = await supabase
    .from("hints")
    .select("asset_path")
    .eq("id", hintId)
    .maybeSingle();
  if (!hint?.asset_path) return new NextResponse("Not found", { status: 404 });
  const { data, error } = await createAdminClient().storage
    .from("game-assets")
    .download(hint.asset_path);
  if (error) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(data, {
    headers: {
      "Content-Type": data.type || "application/octet-stream",
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
