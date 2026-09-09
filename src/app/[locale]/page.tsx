import {
  BadgeCheck,
  Eye,
  Gavel,
  HandCoins,
  Lightbulb,
  Link2,
  ListChecks,
  MonitorUp,
  Radio,
  Scale,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { routing } from "@/i18n/routing";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  return {
    title: t("landing.meta.title"),
    description: t("landing.meta.description"),
    alternates: {
      canonical: `/${locale}`,
      languages: Object.fromEntries(
        routing.locales.map((code) => [code, `/${code}`]),
      ),
    },
    openGraph: {
      title: t("landing.meta.title"),
      description: t("landing.meta.description"),
      type: "website",
      locale,
    },
  };
}

type Step = { title: string; body: string };
type Feature = { title: string; body: string };
type Format = { name: string; time: string; flow: string };
type Faq = { q: string; body: string };

const STEP_ICONS = [Sparkles, Link2, Smartphone, Zap] as const;
const FEATURE_ICONS = [
  Smartphone,
  MonitorUp,
  Radio,
  Lightbulb,
  Wallet,
  HandCoins,
] as const;
const FAIR_ICONS = [HandCoins, ShieldCheck, Scale, Gavel] as const;

export default async function LandingPage({ params }: Params) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const trust = t.raw("landing.trust") as string[];
  const steps = t.raw("landing.how.steps") as Step[];
  const features = t.raw("landing.features.items") as Feature[];
  const formats = t.raw("landing.formats.items") as Format[];
  const fair = t.raw("landing.fair.items") as string[];
  const faqs = t.raw("landing.faq.items") as Faq[];

  const otherLocale = routing.locales.find((code) => code !== locale) ?? locale;

  return (
    <main className="mx-auto min-h-dvh max-w-6xl px-5 py-6 sm:px-8">
      <nav className="flex flex-wrap items-center justify-between gap-3">
        <a
          href={`/${locale}`}
          className="display flex items-center gap-2 text-2xl font-black"
        >
          <span className="grid size-10 place-items-center rounded-full bg-pink-500 text-white">
            <Eye size={23} />
          </span>
          {t("brand")}
        </a>
        <div className="hidden items-center gap-7 text-sm font-bold text-[var(--muted)] md:flex">
          <a href="#how" className="hover:text-[var(--ink)]">
            {t("landing.nav.how")}
          </a>
          <a href="#features" className="hover:text-[var(--ink)]">
            {t("landing.nav.features")}
          </a>
          <a href="#formats" className="hover:text-[var(--ink)]">
            {t("landing.nav.formats")}
          </a>
          <a href="#faq" className="hover:text-[var(--ink)]">
            {t("landing.nav.faq")}
          </a>
        </div>
        <div className="flex items-center gap-2">
          <a href={`/${locale}/login`} className="pill pill-secondary">
            {t("landing.login")}
          </a>
          <a
            href={`/${locale}/login?mode=signup`}
            className="pill pill-primary hidden sm:inline-flex"
          >
            <Zap size={18} /> {t("landing.start")}
          </a>
        </div>
      </nav>

      <section className="grid min-h-[78dvh] items-center gap-12 overflow-x-clip py-16 lg:grid-cols-[1.1fr_.9fr]">
        <div>
          <p className="mb-4 font-extrabold uppercase tracking-[.16em] text-pink-600">
            <Sparkles className="mr-2 inline" size={18} />
            {t("landing.eyebrow")}
          </p>
          <h1 className="display max-w-3xl text-5xl font-black leading-[.96] sm:text-7xl">
            {t("landing.title")}
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-[var(--muted)] sm:text-xl">
            {t("landing.subtitle")}
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <a
              href={`/${locale}/login?mode=signup`}
              className="pill pill-primary"
            >
              <Zap size={19} /> {t("landing.start")}
            </a>
            <a href="#how" className="pill pill-secondary">
              <Lightbulb size={19} /> {t("landing.howCta")}
            </a>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm font-bold text-[var(--muted)]">
            {trust.map((item) => (
              <li key={item} className="flex items-center gap-2">
                <BadgeCheck size={16} className="text-pink-500" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mx-auto w-full max-w-md">
          <div className="bubble-card float rotate-2 p-5">
            <div className="rounded-[1.2rem] bg-gradient-to-br from-pink-500 to-violet-600 p-6 text-white">
              <p className="text-sm font-black uppercase tracking-widest">
                {t("landing.mock.round")}
              </p>
              <h2 className="display mt-2 text-4xl font-black">
                {t("landing.mock.phase")}
              </h2>
              <div className="mt-10 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white/20 p-4">
                  <p className="text-sm">{t("landing.mock.wallet")}</p>
                  <p className="display text-2xl font-black">12 500 ¤</p>
                </div>
                <div className="rounded-2xl bg-white/20 p-4">
                  <p className="text-sm">{t("landing.mock.hints")}</p>
                  <p className="display text-2xl font-black">4</p>
                </div>
              </div>
              <div className="mt-4 rounded-full bg-white px-5 py-4 text-center font-black text-pink-600">
                {t("landing.mock.buzz")}
              </div>
            </div>
          </div>
          <div className="absolute -bottom-8 -left-5 -z-10 size-36 rounded-full bg-yellow-200 blur-sm" />
          <div className="absolute -right-7 -top-9 -z-10 size-44 rounded-full bg-pink-200 blur-sm" />
        </div>
      </section>

      <section className="py-16">
        <h2 className="display text-3xl font-black sm:text-4xl">
          {t("landing.screens.title")}
        </h2>
        <p className="mt-3 max-w-2xl leading-8 text-[var(--muted)]">
          {t("landing.screens.subtitle")}
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <article className="bubble-card p-6">
            <Smartphone className="text-pink-600" />
            <h3 className="display mt-5 text-2xl font-black">
              {t("landing.screens.phone.title")}
            </h3>
            <p className="mt-2 leading-7 text-[var(--muted)]">
              {t("landing.screens.phone.body")}
            </p>
          </article>
          <article className="bubble-card p-6">
            <MonitorUp className="text-pink-600" />
            <h3 className="display mt-5 text-2xl font-black">
              {t("landing.screens.tv.title")}
            </h3>
            <p className="mt-2 leading-7 text-[var(--muted)]">
              {t("landing.screens.tv.body")}
            </p>
          </article>
        </div>
      </section>

      <section id="how" className="scroll-mt-20 py-16">
        <h2 className="display text-3xl font-black sm:text-4xl">
          {t("landing.how.title")}
        </h2>
        <p className="mt-3 max-w-2xl leading-8 text-[var(--muted)]">
          {t("landing.how.subtitle")}
        </p>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => {
            const StepIcon = STEP_ICONS[index] ?? Sparkles;
            return (
              <li key={step.title} className="bubble-card p-6">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-full bg-pink-100 text-sm font-black text-pink-700">
                    {index + 1}
                  </span>
                  <StepIcon className="text-pink-600" size={20} />
                </div>
                <h3 className="display mt-4 text-xl font-black">{step.title}</h3>
                <p className="mt-2 leading-7 text-[var(--muted)]">{step.body}</p>
              </li>
            );
          })}
        </ol>
      </section>

      <section id="features" className="scroll-mt-20 py-16">
        <h2 className="display text-3xl font-black sm:text-4xl">
          {t("landing.features.title")}
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, index) => {
            const FeatureIcon = FEATURE_ICONS[index] ?? Sparkles;
            return (
              <article key={feature.title} className="bubble-card p-6">
                <FeatureIcon className="text-pink-600" />
                <h3 className="display mt-5 text-2xl font-black">
                  {feature.title}
                </h3>
                <p className="mt-2 leading-7 text-[var(--muted)]">
                  {feature.body}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <section id="formats" className="scroll-mt-20 py-16">
        <h2 className="display text-3xl font-black sm:text-4xl">
          {t("landing.formats.title")}
        </h2>
        <p className="mt-3 max-w-2xl leading-8 text-[var(--muted)]">
          {t("landing.formats.subtitle")}
        </p>
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {formats.map((format) => (
            <article key={format.name} className="bubble-card p-6">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="display text-2xl font-black">{format.name}</h3>
                <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black uppercase tracking-wider text-violet-700">
                  {format.time}
                </span>
              </div>
              <p className="mt-3 leading-7 text-[var(--muted)]">{format.flow}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="py-16">
        <div className="bubble-card p-7 sm:p-10">
          <h2 className="display flex items-center gap-3 text-3xl font-black sm:text-4xl">
            <ShieldCheck className="text-pink-600" size={30} />
            {t("landing.fair.title")}
          </h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {fair.map((item, index) => {
              const FairIcon = FAIR_ICONS[index] ?? ShieldCheck;
              return (
                <li key={item} className="flex gap-3 leading-7">
                  <FairIcon
                    className="mt-1 shrink-0 text-pink-500"
                    size={18}
                  />
                  <span className="text-[var(--muted)]">{item}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section id="faq" className="scroll-mt-20 py-16">
        <h2 className="display text-3xl font-black sm:text-4xl">
          {t("landing.faq.title")}
        </h2>
        <div className="mt-8 grid gap-3">
          {faqs.map((faq) => (
            <details key={faq.q} className="bubble-card p-5 sm:p-6">
              <summary className="display cursor-pointer list-none text-lg font-black">
                {faq.q}
              </summary>
              <p className="mt-3 leading-7 text-[var(--muted)]">{faq.body}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="py-16">
        <div className="bubble-card overflow-hidden p-1">
          <div className="rounded-[calc(var(--radius)-0.25rem)] bg-gradient-to-br from-pink-500 to-violet-600 p-9 text-center text-white sm:p-14">
            <h2 className="display mx-auto max-w-2xl text-3xl font-black sm:text-5xl">
              {t("landing.cta.title")}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg leading-8 text-white/85">
              {t("landing.cta.body")}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <a
                href={`/${locale}/login?mode=signup`}
                className="pill bg-white text-pink-600"
              >
                <Zap size={19} /> {t("landing.cta.button")}
              </a>
              <a
                href={`/${locale}/login`}
                className="pill border border-white/40 bg-transparent text-white"
              >
                {t("landing.login")}
              </a>
            </div>
          </div>
        </div>
      </section>

      <footer className="flex flex-col gap-6 border-t border-[var(--border)] py-10 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-md">
          <p className="display flex items-center gap-2 text-xl font-black">
            <span className="grid size-8 place-items-center rounded-full bg-pink-500 text-white">
              <Eye size={18} />
            </span>
            {t("brand")}
          </p>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            {t("landing.footer.tagline")}
          </p>
        </div>
        <div className="flex flex-col gap-3 text-sm font-bold text-[var(--muted)]">
          <a
            href={`/${locale}/login`}
            className="flex items-center gap-2 hover:text-[var(--ink)]"
          >
            <Users size={15} /> {t("landing.login")}
          </a>
          <a
            href="#how"
            className="flex items-center gap-2 hover:text-[var(--ink)]"
          >
            <ListChecks size={15} /> {t("landing.nav.how")}
          </a>
          <a
            href={`/${otherLocale}`}
            className="flex items-center gap-2 hover:text-[var(--ink)]"
          >
            <Link2 size={15} /> {t("landing.footer.language")}: {otherLocale.toUpperCase()}
          </a>
        </div>
      </footer>

      <p className="pb-10 text-xs leading-5 text-[var(--muted)]">
        {t("landing.footer.rights")}
      </p>
    </main>
  );
}
