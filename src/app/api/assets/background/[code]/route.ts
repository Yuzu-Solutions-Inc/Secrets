import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("public_game_dashboard", { p_code: code });
  const dashboard = data as { game?: { background_path?: string | null } } | null;
  const path = dashboard?.game?.background_path;
  if (!path) return new NextResponse("Not found", { status: 404 });
  const { data: file, error } = await createAdminClient().storage.from("game-assets").download(path);
  if (error) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(file, {
    headers: {
      "Content-Type": file.type || "image/jpeg",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
