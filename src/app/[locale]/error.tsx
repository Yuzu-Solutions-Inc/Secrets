"use client";

import { useEffect } from "react";
import { RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";

export default function LocaleError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations("errorPage");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center px-5">
      <div className="bubble-card max-w-md p-7 text-center">
        <h1 className="display text-3xl font-black">{t("title")}</h1>
        <p className="mt-3 text-[var(--muted)]">{t("body")}</p>
        {error.digest ? (
          <p className="mt-2 font-mono text-xs text-[var(--muted)]">{error.digest}</p>
        ) : null}
        <button className="pill pill-primary mt-6 w-full" onClick={() => retry()}>
          <RotateCw size={18} /> {t("retry")}
        </button>
      </div>
    </main>
  );
}
