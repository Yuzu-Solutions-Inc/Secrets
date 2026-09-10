import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  const { assignmentId } = await params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return new NextResponse("Unauthorized", { status: 401 });

  // RLS (mission_assignments_scoped_select) only returns this row to the
  // assignee, their team-mates, or a game admin.
  const { data: assignment } = await supabase
    .from("mission_assignments")
    .select("evidence_path")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!assignment?.evidence_path) return new NextResponse("Not found", { status: 404 });

  const { data, error } = await createAdminClient().storage
    .from("game-assets")
    .download(assignment.evidence_path);
  if (error) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(data, {
    headers: {
      "Content-Type": data.type || "application/octet-stream",
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
