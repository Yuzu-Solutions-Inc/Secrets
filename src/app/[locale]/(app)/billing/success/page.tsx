import { PartyPopper } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { getEntitlementSummary } from "@/lib/billing/entitlement";

export const dynamic = "force-dynamic";

export default async function BillingSuccessPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("billing");
  const summary = await getEntitlementSummary();
  const applied = summary.effectivePlan !== "free" || !summary.freeTrialAvailable;

  return (
    <section className="mx-auto max-w-lg py-12 text-center">
      <div className="bubble-card p-8">
        <PartyPopper className="mx-auto text-pink-500" size={40} />
        <h1 className="display mt-4 text-3xl font-black">{t("successTitle")}</h1>
        <p className="mt-3 leading-7 text-[var(--muted)]">
          {applied ? t("successBody") : t("successPending")}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a className="pill pill-primary" href={`/${locale}/games/new`}>{t("backToNewGame")}</a>
          <a className="pill bg-white" href={`/${locale}/billing`}>{t("backToPlans")}</a>
        </div>
      </div>
    </section>
  );
}
