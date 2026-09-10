import { Eye, Gamepad2, UserRound } from "lucide-react";

import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export async function AppShell({
  locale,
  children,
}: {
  locale: string;
  children: React.ReactNode;
}) {
  const user = await getUser();
  let profile: { display_name: string | null; avatar_path: string | null; updated_at: string | null } | null = null;
  if (user) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select("display_name, avatar_path, updated_at")
      .eq("id", user.id)
      .single();
    profile = data;
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-pink-100 bg-[color:var(--cream)]/90 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-3">
          <a href={`/${locale}/games`} className="display flex items-center gap-2 text-xl font-black">
            <span className="grid size-9 place-items-center rounded-full bg-pink-500 text-white">
              <Eye size={20} />
            </span>
            Secrets
          </a>
          <div className="flex items-center gap-2">
            <a className="pill bg-white text-sm" href={`/${locale}/games`}>
              <Gamepad2 size={18} /> My games
            </a>
            <a
              className="grid size-11 place-items-center overflow-hidden rounded-full bg-pink-100 text-pink-600 hover:bg-pink-200"
              href={`/${locale}/profile`}
              aria-label="Profile"
            >
              {profile?.avatar_path && user ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/assets/avatar/${user.id}?v=${encodeURIComponent(String(profile.updated_at ?? ""))}`}
                  alt={profile.display_name ?? "Profile"}
                  className="size-full object-cover"
                />
              ) : (
                <UserRound size={20} />
              )}
            </a>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-7">{children}</main>
      <nav className="safe-bottom sticky bottom-0 z-30 border-t border-pink-100 bg-white/94 backdrop-blur-xl sm:hidden">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-2 px-5 pt-2">
          <a className="flex min-h-12 flex-col items-center justify-center text-xs font-bold text-pink-600" href={`/${locale}/games`}>
            <Gamepad2 size={21} /> Games
          </a>
          <a className="flex min-h-12 flex-col items-center justify-center text-xs font-bold" href={`/${locale}/profile`}>
            <UserRound size={21} /> Profile
          </a>
        </div>
      </nav>
    </div>
  );
}
