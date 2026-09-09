"use client";

import { Check, Copy, UserPlus, X } from "lucide-react";
import { useActionState, useState } from "react";

import { addToWhitelist, removeFromWhitelist, type WhitelistState } from "@/app/actions/invitations";

const initial: WhitelistState = {};

type Row = { id: string; email: string };

export function WhitelistManager({
  locale,
  gameId,
  inviteUrl,
  whitelist,
}: {
  locale: string;
  gameId: string;
  inviteUrl: string;
  whitelist: Row[];
}) {
  const [state, action, pending] = useActionState(addToWhitelist, initial);
  const [copied, setCopied] = useState(false);

  return (
    <div className="bubble-card mb-4 p-5">
      <p className="font-black">Invite players</p>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Everyone joins with the same link. Only the emails you add below can actually get in.
      </p>

      <div className="mt-3 flex items-center gap-2 rounded-2xl bg-pink-50 p-2 pl-4">
        <code className="min-w-0 flex-1 truncate text-xs">{inviteUrl}</code>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(inviteUrl);
            setCopied(true);
          }}
          className="pill pill-secondary shrink-0"
        >
          {copied ? <Check size={17} /> : <Copy size={17} />} {copied ? "Copied" : "Copy link"}
        </button>
      </div>

      <form action={action} className="mt-3 flex flex-col gap-3 sm:flex-row">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="gameId" value={gameId} />
        <input className="field flex-1" name="email" type="email" placeholder="friend@example.com" required />
        <button className="pill pill-primary shrink-0" disabled={pending}><UserPlus size={18} /> Add email</button>
      </form>
      {state.error ? <p className="mt-2 text-sm font-bold text-red-600">{state.error}</p> : null}

      {whitelist.length ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {whitelist.map((row) => (
            <li key={row.id} className="flex items-center gap-1 rounded-full bg-pink-50 py-1 pl-3 pr-1 text-sm">
              <span className="truncate">{row.email}</span>
              <form action={removeFromWhitelist}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="gameId" value={gameId} />
                <input type="hidden" name="id" value={row.id} />
                <button className="grid size-6 place-items-center rounded-full hover:bg-pink-200" aria-label={`Remove ${row.email}`}>
                  <X size={14} />
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-[var(--muted)]">No emails on the list yet.</p>
      )}
    </div>
  );
}
