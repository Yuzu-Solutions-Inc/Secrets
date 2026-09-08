"use client";

import { Check, Copy, UserPlus } from "lucide-react";
import { useActionState, useState } from "react";

import { createInvitation, type InviteState } from "@/app/actions/invitations";

const initial: InviteState = {};

export function InvitePlayerForm({
  locale,
  organizationId,
  gameId,
}: {
  locale: string;
  organizationId: string;
  gameId: string;
}) {
  const [state, action, pending] = useActionState(createInvitation, initial);
  const [copied, setCopied] = useState(false);

  return (
    <div className="bubble-card mb-4 p-5">
      <form action={action} className="flex flex-col gap-3 sm:flex-row">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="gameId" value={gameId} />
        <input className="field flex-1" name="email" type="email" placeholder="friend@example.com" required />
        <button className="pill pill-primary shrink-0" disabled={pending}><UserPlus size={18} /> Invite player</button>
      </form>
      {state.error ? <p className="mt-2 text-sm font-bold text-red-600">{state.error}</p> : null}
      {state.inviteUrl ? (
        <div className="mt-3 flex items-center gap-2 rounded-2xl bg-pink-50 p-2 pl-4">
          <code className="min-w-0 flex-1 truncate text-xs">{state.inviteUrl}</code>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(state.inviteUrl!);
              setCopied(true);
            }}
            className="pill pill-secondary shrink-0"
          >
            {copied ? <Check size={17} /> : <Copy size={17} />} {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
