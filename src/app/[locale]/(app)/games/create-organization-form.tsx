"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { createOrganization, type CreateOrganizationState } from "@/app/actions/game";

const initialState: CreateOrganizationState = { error: null };

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      className="pill pill-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
      type="submit"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? "Creating…" : label}
    </button>
  );
}

export function CreateOrganizationForm({ locale, label }: { locale: string; label: string }) {
  const [state, formAction] = useActionState(createOrganization, initialState);

  return (
    <form action={formAction} className="mt-7 space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <input
        className="field"
        name="name"
        placeholder="Friday Night Crew"
        required
        minLength={2}
        maxLength={80}
      />
      {state.error ? (
        <p role="alert" className="text-sm font-semibold text-red-600">
          {state.error}
        </p>
      ) : null}
      <SubmitButton label={label} />
    </form>
  );
}
