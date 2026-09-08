import { Eye, Lightbulb, MonitorUp, Smartphone, Sparkles, Zap } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  return (
    <main className="mx-auto min-h-dvh max-w-6xl px-5 py-6 sm:px-8">
      <nav className="flex items-center justify-between">
        <a href={`/${locale}`} className="display flex items-center gap-2 text-2xl font-black">
          <span className="grid size-10 place-items-center rounded-full bg-pink-500 text-white">
            <Eye size={23} />
          </span>
          {t("brand")}
        </a>
        <a href={`/${locale}/login`} className="pill pill-secondary">
          {t("landing.login")}
        </a>
      </nav>

      <section className="grid min-h-[78dvh] items-center gap-12 py-16 lg:grid-cols-[1.1fr_.9fr]">
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
            <a href={`/${locale}/login?mode=signup`} className="pill pill-primary">
              <Zap size={19} /> {t("landing.start")}
            </a>
            <a href="#features" className="pill pill-secondary">
              <Lightbulb size={19} /> How it works
            </a>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-md">
          <div className="bubble-card float rotate-2 p-5">
            <div className="rounded-[1.2rem] bg-gradient-to-br from-pink-500 to-violet-600 p-6 text-white">
              <p className="text-sm font-black uppercase tracking-widest">Round 2</p>
              <h2 className="display mt-2 text-4xl font-black">Solo investigation</h2>
              <div className="mt-10 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white/20 p-4">
                  <p className="text-sm">Your wallet</p>
                  <p className="display text-2xl font-black">12 500 ¤</p>
                </div>
                <div className="rounded-2xl bg-white/20 p-4">
                  <p className="text-sm">Hints owned</p>
                  <p className="display text-2xl font-black">4</p>
                </div>
              </div>
              <div className="mt-4 rounded-full bg-white px-5 py-4 text-center font-black text-pink-600">
                BUZZ
              </div>
            </div>
          </div>
          <div className="absolute -bottom-8 -left-5 -z-10 size-36 rounded-full bg-yellow-200 blur-sm" />
          <div className="absolute -right-7 -top-9 -z-10 size-44 rounded-full bg-pink-200 blur-sm" />
        </div>
      </section>

      <section id="features" className="grid gap-4 pb-20 sm:grid-cols-3">
        {[
          [Smartphone, t("landing.phone"), "Big controls, private clues and buzzes in your pocket."],
          [MonitorUp, t("landing.tv"), "A dramatic, safe dashboard made for the room."],
          [Zap, t("landing.live"), "Rounds, balances and reveals stay perfectly in sync."],
        ].map(([Icon, title, body]) => {
          const FeatureIcon = Icon as typeof Smartphone;
          return (
            <article key={String(title)} className="bubble-card p-6">
              <FeatureIcon className="text-pink-600" />
              <h2 className="display mt-5 text-2xl font-black">{String(title)}</h2>
              <p className="mt-2 leading-7 text-[var(--muted)]">{String(body)}</p>
            </article>
          );
        })}
      </section>
    </main>
  );
}
