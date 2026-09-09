import { Check, Crown, Sparkles } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { startCheckout } from "@/app/actions/billing";
import { getEntitlementSummary } from "@/lib/billing/entitlement";

export const dynamic = "force-dynamic";

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ need?: string }>;
}) {
  const { locale } = await params;
  const { need } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("billing");
  const summary = await getEntitlementSummary();

  const status = summary.unlimited
    ? t("statusUnlimited")
    : summary.effectivePlan === "pro_pack"
      ? t("statusPack", { credits: summary.credits })
      : summary.freeTrialAvailable
        ? t("statusFreeTrial")
        : t("statusFree");

  const expiresLabel = summary.expiresAt
    ? t("expires", {
        date: new Date(summary.expiresAt).toLocaleDateString(locale, { dateStyle: "medium" }),
      })
    : null;

  return (
    <section className="mx-auto max-w-3xl">
      <p className="font-bold uppercase tracking-widest text-pink-600">{t("current")}</p>
      <h1 className="display text-4xl font-black sm:text-5xl">{t("title")}</h1>
      <p className="mt-2 leading-7 text-[var(--muted)]">{t("subtitle")}</p>

      {need === "pro" ? (
        <p className="mt-4 rounded-2xl bg-pink-50 px-4 py-3 font-bold text-pink-700">{t("needPro")}</p>
      ) : null}

      <div className="bubble-card mt-6 flex flex-wrap items-center gap-3 p-5">
        <Crown className="text-pink-600" />
        <span className="font-black">{status}</span>
        {expiresLabel ? <span className="text-sm text-[var(--muted)]">· {expiresLabel}</span> : null}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {/* Free */}
        <div className="bubble-card flex flex-col p-6">
          <span className="text-xs font-black uppercase tracking-widest text-[var(--muted)]">{t("freeName")}</span>
          <span className="display mt-2 text-3xl font-black">{t("freePrice")}</span>
          <p className="mt-2 text-sm text-[var(--muted)]">{t("freeBlurb")}</p>
          <ul className="mt-4 space-y-2 text-sm">
            {[t("freeF1"), t("freeF2"), t("freeF3")].map((line) => (
              <li key={line} className="flex gap-2">
                <Check size={16} className="mt-0.5 shrink-0 text-pink-500" /> {line}
              </li>
            ))}
          </ul>
        </div>

        {/* 3 games */}
        <form action={startCheckout} className="bubble-card flex flex-col p-6">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="sku" value="pro_pack_3" />
          <span className="text-xs font-black uppercase tracking-widest text-pink-600">{t("packName")}</span>
          <span className="display mt-2 text-3xl font-black">{t("packPrice")}</span>
          <p className="mt-2 text-sm text-[var(--muted)]">{t("packBlurb")}</p>
          <ul className="mt-4 space-y-2 text-sm">
            {[t("proF1"), t("proF2"), t("proF3"), t("proF4")].map((line) => (
              <li key={line} className="flex gap-2">
                <Check size={16} className="mt-0.5 shrink-0 text-pink-500" /> {line}
              </li>
            ))}
          </ul>
          <button className="pill pill-primary mt-5 w-full">{t("buyPack")}</button>
        </form>

        {/* Unlimited */}
        <form action={startCheckout} className="bubble-card flex flex-col border-2 border-pink-400 p-6">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="sku" value="pro_unlimited" />
          <span className="flex items-center gap-1 text-xs font-black uppercase tracking-widest text-pink-600">
            <Sparkles size={14} /> {t("unlimitedName")}
          </span>
          <span className="display mt-2 text-3xl font-black">{t("unlimitedPrice")}</span>
          <p className="mt-2 text-sm text-[var(--muted)]">{t("unlimitedBlurb")}</p>
          <ul className="mt-4 space-y-2 text-sm">
            {[t("proF1"), t("proF2"), t("proF3"), t("proF4")].map((line) => (
              <li key={line} className="flex gap-2">
                <Check size={16} className="mt-0.5 shrink-0 text-pink-500" /> {line}
              </li>
            ))}
          </ul>
          <button className="pill pill-primary mt-5 w-full">{t("buyUnlimited")}</button>
        </form>
      </div>
    </section>
  );
}
