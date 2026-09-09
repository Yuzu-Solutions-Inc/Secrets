import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return new NextResponse("Unauthorized", { status: 401 });

  // RLS (profiles_self_select) only returns this row for the caller's own
  // profile or a co-organization member, so the avatar bytes stay inside the
  // player's group.
  const { data: profile } = await supabase
    .from("profiles")
    .select("avatar_path")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.avatar_path) return new NextResponse("Not found", { status: 404 });

  const { data, error } = await createAdminClient().storage
    .from("game-assets")
    .download(profile.avatar_path);
  if (error || !data) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(data, {
    headers: {
      "Content-Type": data.type || "image/webp",
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
