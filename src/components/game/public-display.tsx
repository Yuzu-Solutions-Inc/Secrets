"use client";

import { Eye, Maximize2, Sparkles, Timer, Volume2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/utils";

type Row = Record<string, unknown>;

export function PublicDisplay({
  game,
  players,
  round,
  latestEvent,
}: {
  locale: string;
  game: Row;
  players: Row[];
  round: Row | null;
  latestEvent: Row | null;
}) {
  const t = useTranslations("display");
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const supabase = createClient();
    const channel = supabase
      .channel(`display:${String(game.id)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "display_cues", filter: `game_id=eq.${String(game.id)}` }, () => router.refresh())
      .subscribe();
    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [game.id, router]);

  const end = round?.ends_at ? new Date(String(round.ends_at)).getTime() : null;
  const remaining = end && now ? Math.max(0, Math.floor((end - now) / 1000)) : null;

  return (
    <main
      className="screen-safe relative min-h-dvh overflow-hidden bg-[radial-gradient(circle_at_top_left,#ff83c7,transparent_35%),radial-gradient(circle_at_bottom_right,#a855f7,transparent_40%),#2b0a2d] bg-cover bg-center text-white"
      style={game.background_path ? { backgroundImage: `linear-gradient(rgba(43,10,45,.74),rgba(43,10,45,.86)),url(/api/assets/background/${String(game.public_code)})` } : undefined}
    >
      <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
      <section className="relative z-10 flex min-h-[calc(100dvh-8vw)] flex-col">
        <header className="flex items-start justify-between gap-6">
          <div>
            <p className="flex items-center gap-3 text-[clamp(.8rem,1.2vw,1.4rem)] font-black uppercase tracking-[.22em] text-pink-200">
              <Eye /> #{String(game.public_code)}
            </p>
            <h1 className="display mt-2 text-[clamp(3rem,7vw,8rem)] font-black leading-none">{String(game.title)}</h1>
          </div>
          <div className="flex gap-3">
            <button onClick={() => void document.documentElement.requestFullscreen()} className="grid size-[clamp(3.5rem,5vw,6rem)] place-items-center rounded-full bg-white/15 backdrop-blur">
              <Maximize2 size="45%" />
            </button>
            <div className="grid size-[clamp(3.5rem,5vw,6rem)] place-items-center rounded-full bg-white/15 backdrop-blur">
              <Volume2 size="45%" />
            </div>
          </div>
        </header>

        <div className="mt-[clamp(2rem,4vw,5rem)] grid flex-1 gap-[clamp(1rem,2vw,2.5rem)] lg:grid-cols-[.8fr_1.2fr]">
          <article className="flex flex-col justify-between rounded-[clamp(2rem,4vw,4rem)] border border-white/20 bg-white/12 p-[clamp(2rem,4vw,5rem)] backdrop-blur-xl">
            <div>
              <p className="text-[clamp(1rem,1.4vw,1.6rem)] font-black uppercase tracking-[.2em] text-pink-200">{t("round")}</p>
              <h2 className="display mt-4 text-[clamp(3rem,5vw,6.5rem)] font-black leading-[.95]">{String(round?.title ?? t("waiting"))}</h2>
            </div>
            {remaining !== null ? (
              <div className="mt-8 flex items-center gap-4">
                <Timer size="9%" />
                <span className="display text-[clamp(3rem,6vw,7rem)] font-black tabular-nums">
                  {String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}
                </span>
              </div>
            ) : null}
            {latestEvent ? (
              <div className="mt-8 rounded-[2rem] bg-white p-[clamp(1.5rem,2.5vw,3rem)] text-[var(--ink)]">
                <p className="flex items-center gap-2 font-black uppercase tracking-widest text-pink-600"><Sparkles /> Live</p>
                <h3 className="display mt-2 text-[clamp(2rem,3vw,4rem)] font-black">{String(latestEvent.title)}</h3>
                <p className="mt-2 text-[clamp(1rem,1.4vw,1.6rem)]">{String(latestEvent.body ?? "")}</p>
              </div>
            ) : null}
          </article>

          <article className="rounded-[clamp(2rem,4vw,4rem)] bg-white p-[clamp(2rem,3vw,4rem)] text-[var(--ink)]">
            <p className="text-[clamp(1rem,1.4vw,1.6rem)] font-black uppercase tracking-[.2em] text-pink-600">{t("balances")}</p>
            <div className="mt-[clamp(1rem,2vw,2rem)] grid grid-cols-2 gap-[clamp(.7rem,1.4vw,1.5rem)] xl:grid-cols-3">
              {players.map((player) => {
                return (
                  <div key={String(player.id)} className="rounded-[clamp(1.2rem,2vw,2rem)] bg-pink-50 p-[clamp(1rem,1.7vw,2rem)]">
                    <div className="flex items-center gap-3">
                      <span className="grid size-[clamp(2.5rem,4vw,5rem)] place-items-center rounded-full bg-gradient-to-br from-pink-400 to-violet-600 text-[clamp(1rem,2vw,2rem)] font-black text-white">
                        {String(player.display_name ?? "?").slice(0, 1)}
                      </span>
                      <p className="truncate text-[clamp(1rem,1.7vw,2rem)] font-black">{String(player.display_name ?? "Player")}</p>
                    </div>
                    <p className="display mt-3 text-[clamp(1.5rem,2.4vw,3rem)] font-black text-pink-700">
                      {formatMoney(Number(player.balance ?? 0), String(game.currency_symbol))}
                    </p>
                  </div>
                );
              })}
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}
