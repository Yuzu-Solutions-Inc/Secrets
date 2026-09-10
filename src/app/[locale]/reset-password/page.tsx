import { LockKeyhole } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { updatePassword } from "@/app/actions/auth";

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth");
  return (
    <main className="grid min-h-dvh place-items-center px-5">
      <form action={updatePassword} className="bubble-card w-full max-w-md p-7">
        <LockKeyhole className="text-pink-600" size={36} />
        <h1 className="display mt-4 text-4xl font-black">{t("resetTitle")}</h1>
        <input type="hidden" name="locale" value={locale} />
        <input className="field mt-6" name="password" type="password" minLength={8} required autoComplete="new-password" />
        <button className="pill pill-primary mt-4 w-full">{t("resetCta")}</button>
      </form>
    </main>
  );
}
