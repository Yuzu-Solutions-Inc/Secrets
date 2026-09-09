"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { joinGame, type JoinGameState } from "@/app/actions/invitations";

const initial: JoinGameState = {};

export function JoinGameForm({ locale, token }: { locale: string; token: string }) {
  const t = useTranslations("invite");
  const [state, action, pending] = useActionState(joinGame, initial);

  return (
    <form action={action} className="mt-6">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="token" value={token} />
      <button className="pill pill-primary w-full" disabled={pending}>
        {pending ? t("joining") : t("join")}
      </button>
      {state.error ? (
        <p className="mt-3 text-sm font-bold text-red-600">{t(`errors.${state.error}`)}</p>
      ) : null}
    </form>
  );
}
