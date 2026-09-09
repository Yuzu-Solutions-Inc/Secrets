"use client";

import { useActionState } from "react";
import { PartyPopper } from "lucide-react";
import { useTranslations } from "next-intl";

import { acceptInvitation, type AcceptInviteState } from "@/app/actions/invitations";

const initial: AcceptInviteState = {};

export function AcceptInvitationForm({
  locale,
  token,
}: {
  locale: string;
  token: string;
}) {
  const t = useTranslations("invite");
  const [state, action, pending] = useActionState(acceptInvitation, initial);

  return (
    <>
      {state.error ? (
        <p
          role="alert"
          className="mt-5 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600"
        >
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
      <form action={action} className="mt-7">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="token" value={token} />
        <button className="pill pill-primary w-full" disabled={pending}>
          <PartyPopper size={18} />
          {pending ? t("joining") : t("join")}
        </button>
      </form>
    </>
  );
}
