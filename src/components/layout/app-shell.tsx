import { Eye, Gamepad2, LogOut, Plus, Settings2 } from "lucide-react";

import { signOut } from "@/app/actions/auth";

export function AppShell({
  locale,
  children,
}: {
  locale: string;
  children: React.ReactNode;
}) {
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
          <div className="flex items-center gap-1">
            <a className="grid size-11 place-items-center rounded-full hover:bg-pink-100" href={`/${locale}/games/new`} aria-label="New game">
              <Plus />
            </a>
            <a className="grid size-11 place-items-center rounded-full hover:bg-pink-100" href={`/${locale}/profile`} aria-label="Profile">
              <Settings2 />
            </a>
            <form action={signOut}>
              <input type="hidden" name="locale" value={locale} />
              <button className="grid size-11 place-items-center rounded-full hover:bg-pink-100" aria-label="Sign out">
                <LogOut />
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-7">{children}</main>
      <nav className="safe-bottom sticky bottom-0 z-30 border-t border-pink-100 bg-white/94 backdrop-blur-xl sm:hidden">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-2 px-5 pt-2">
          <a className="flex min-h-12 flex-col items-center justify-center text-xs font-bold text-pink-600" href={`/${locale}/games`}>
            <Gamepad2 size={21} /> Games
          </a>
          <a className="flex min-h-12 flex-col items-center justify-center text-xs font-bold" href={`/${locale}/games/new`}>
            <Plus size={21} /> New
          </a>
        </div>
      </nav>
    </div>
  );
}
