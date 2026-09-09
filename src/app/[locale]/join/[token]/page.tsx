import { Eye, PartyPopper } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { JoinGameForm } from "@/components/game/join-game-form";
import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("invite");

  const joinPath = `/${locale}/join/${token}`;
  const user = await getUser();
  if (!user) {
    redirect(`/${locale}/login?next=${encodeURIComponent(joinPath)}`);
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc("join_game_summary", { p_token: token });
  const summary = (data && typeof data === "object" ? data : null) as
    | { game_title?: string; organization_name?: string; whitelisted?: boolean; already_player?: boolean }
    | null;

  if (!summary) {
    return <Card title={t("invalidTitle")} body={t("invalidBody")} />;
  }
  if (summary.already_player) {
    redirect(`/${locale}/games`);
  }

  return (
    <main className="grid min-h-dvh place-items-center px-5">
      <div className="bubble-card max-w-md p-7 text-center">
        <PartyPopper className="mx-auto text-pink-600" size={44} />
        <h1 className="display mt-5 text-4xl font-black">{t("title")}</h1>
        <p className="mt-3 text-[var(--muted)]">
          {t("joinWith", {
            game: String(summary.game_title ?? ""),
            org: String(summary.organization_name ?? ""),
          })}
        </p>
        {summary.whitelisted ? (
          <JoinGameForm locale={locale} token={token} />
        ) : (
          <p className="mt-6 text-sm font-bold text-red-600">{t("errors.not_whitelisted")}</p>
        )}
      </div>
    </main>
  );
}

function Card({ title, body }: { title: string; body: string }) {
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
