import { Eye, PartyPopper } from "lucide-react";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { acceptInvitation } from "@/app/actions/invitations";
import { hashInviteToken } from "@/lib/auth/invitations";
import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const supabase = await createClient();
  const { data } = await supabase.rpc("invitation_summary", {
    p_token_hash: hashInviteToken(token),
  });
  const invitation = Array.isArray(data) ? data[0] : data;
  if (!invitation) {
    return <InviteCard title="This invitation is invalid or expired." body="Ask your host for a fresh link." />;
  }
  const user = await getUser();
  if (!user) {
    redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/invite/${token}`)}`);
  }

  return (
    <main className="grid min-h-dvh place-items-center px-5">
      <div className="bubble-card max-w-md p-7 text-center">
        <PartyPopper className="mx-auto text-pink-600" size={44} />
        <h1 className="display mt-5 text-4xl font-black">You’re invited!</h1>
        <p className="mt-3 text-[var(--muted)]">
          Join <strong>{String(invitation.game_title)}</strong> with {String(invitation.organization_name)}.
        </p>
        <form action={acceptInvitation} className="mt-7">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="token" value={token} />
          <button className="pill pill-primary w-full">Join the game</button>
        </form>
      </div>
    </main>
  );
}

function InviteCard({ title, body }: { title: string; body: string }) {
  return (
    <main className="grid min-h-dvh place-items-center px-5">
      <div className="bubble-card max-w-md p-7 text-center">
        <Eye className="mx-auto text-pink-500" size={44} />
        <h1 className="display mt-5 text-3xl font-black">{title}</h1>
        <p className="mt-3 text-[var(--muted)]">{body}</p>
      </div>
    </main>
  );
}
