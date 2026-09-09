import { Eye, PartyPopper } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { signOut } from "@/app/actions/auth";
import { AcceptInvitationForm } from "@/components/game/accept-invitation-form";
import { hashInviteToken, normalizeEmail } from "@/lib/auth/invitations";
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
  const t = await getTranslations("invite");

  const supabase = await createClient();
  const { data } = await supabase.rpc("invitation_summary", {
    p_token_hash: hashInviteToken(token),
  });
  const invitation = Array.isArray(data) ? data[0] : data;
  if (!invitation) {
    return <InviteCard title={t("invalidTitle")} body={t("invalidBody")} />;
  }

  const invitePath = `/${locale}/invite/${token}`;
  const user = await getUser();
  if (!user) {
    redirect(`/${locale}/login?next=${encodeURIComponent(invitePath)}`);
  }

  const invitedEmail = normalizeEmail(String(invitation.invited_email ?? ""));
  const currentEmail = normalizeEmail(user.email ?? "");
  if (invitedEmail && invitedEmail !== currentEmail) {
    return (
      <main className="grid min-h-dvh place-items-center px-5">
        <div className="bubble-card max-w-md p-7 text-center">
          <Eye className="mx-auto text-pink-500" size={44} />
          <h1 className="display mt-5 text-3xl font-black">{t("wrongAccountTitle")}</h1>
          <p className="mt-3 text-[var(--muted)]">
            {t("wrongAccountBody", { invited: invitedEmail, current: currentEmail })}
          </p>
          <form action={signOut} className="mt-7">
            <input type="hidden" name="locale" value={locale} />
            <input
              type="hidden"
              name="next"
              value={`/${locale}/login?next=${encodeURIComponent(invitePath)}`}
            />
            <button className="pill pill-secondary w-full">{t("signOut")}</button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-dvh place-items-center px-5">
      <div className="bubble-card max-w-md p-7 text-center">
        <PartyPopper className="mx-auto text-pink-600" size={44} />
        <h1 className="display mt-5 text-4xl font-black">{t("title")}</h1>
        <p className="mt-3 text-[var(--muted)]">
          {t("joinWith", {
            game: String(invitation.game_title ?? ""),
            org: String(invitation.organization_name ?? ""),
          })}
        </p>
        <AcceptInvitationForm locale={locale} token={token} />
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
