"use client";

import { useActionState, useState } from "react";
import { Eye, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  authenticate,
  requestPasswordReset,
  signInWithGoogle,
  type AuthState,
} from "@/app/actions/auth";

const initial: AuthState = {};

export function AuthForm({
  locale,
  initialMode = "signin",
  next,
}: {
  locale: string;
  initialMode?: "signin" | "signup";
  next?: string;
}) {
  const t = useTranslations("auth");
  const [mode, setMode] = useState(initialMode);
  const [state, action, pending] = useActionState(authenticate, initial);

  return (
    <div className="bubble-card w-full max-w-md p-6 sm:p-8">
      <div className="mb-7 flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-full bg-pink-500 text-white">
          <Eye />
        </span>
        <div>
          <h1 className="display text-3xl font-black">{t("title")}</h1>
          <p className="text-sm text-[var(--muted)]">{t("subtitle")}</p>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 rounded-full bg-pink-50 p-1">
        {(["signin", "signup"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={`rounded-full px-3 py-2 font-bold ${mode === value ? "bg-white shadow-sm" : ""}`}
          >
            {t(value === "signin" ? "signIn" : "signUp")}
          </button>
        ))}
      </div>

      <form action={action} className="space-y-4">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="mode" value={mode} />
        <input type="hidden" name="next" value={next ?? ""} />
        {mode === "signup" ? (
          <label className="block text-sm font-bold">
            {t("name")}
            <input className="field mt-1.5" name="displayName" required autoComplete="name" />
          </label>
        ) : null}
        <label className="block text-sm font-bold">
          {t("email")}
          <input className="field mt-1.5" name="email" type="email" required autoComplete="email" />
        </label>
        <label className="block text-sm font-bold">
          {t("password")}
          <input className="field mt-1.5" name="password" type="password" minLength={8} required autoComplete={mode === "signup" ? "new-password" : "current-password"} />
        </label>
        {state.error ? <p className="text-sm font-bold text-red-600">{t("invalid")}</p> : null}
        {state.success ? <p className="text-sm font-bold text-emerald-700">{t("checkEmail")}</p> : null}
        <button className="pill pill-primary w-full" disabled={pending}>
          <Sparkles size={18} />
          {t(mode === "signin" ? "signIn" : "signUp")}
        </button>
      </form>

      <form action={signInWithGoogle} className="mt-3">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="next" value={next ?? ""} />
        <button className="pill pill-secondary w-full">{t("google")}</button>
      </form>
      {mode === "signin" ? (
        <details className="mt-5 text-sm">
          <summary className="cursor-pointer text-center font-bold text-pink-700">{t("forgot")}</summary>
          <form action={requestPasswordReset} className="mt-3 flex gap-2">
            <input type="hidden" name="locale" value={locale} />
            <input className="field min-w-0" name="email" type="email" placeholder={t("email")} required />
            <button className="pill pill-secondary shrink-0">Send</button>
          </form>
        </details>
      ) : null}
    </div>
  );
}
