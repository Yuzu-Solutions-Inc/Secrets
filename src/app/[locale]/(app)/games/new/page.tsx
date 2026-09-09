import { getTranslations, setRequestLocale } from "next-intl/server";

import { NewGameForm } from "./new-game-form";
import { getEntitlementSummary } from "@/lib/billing/entitlement";
import { getMemberships } from "@/lib/auth/session";

export default async function NewGamePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("games");
  const [memberships, summary] = await Promise.all([getMemberships(), getEntitlementSummary()]);
  const organizationId = memberships[0]?.organization_id as string | undefined;

  return (
    <section className="mx-auto max-w-2xl">
      <p className="font-bold uppercase tracking-widest text-pink-600">Game builder</p>
      <h1 className="display text-4xl font-black sm:text-5xl">{t("new")}</h1>
      <NewGameForm locale={locale} organizationId={organizationId} summary={summary} />
    </section>
  );
}
