"use client";

import { useTransition } from "react";
import { toast } from "sonner";

/**
 * A drop-in replacement for `<form action={serverAction}>` that gives the host
 * visible feedback: the whole form is disabled while the action runs, a success
 * toast fires when it resolves, and a thrown error becomes an error toast
 * instead of tripping the route error boundary.
 */
export function ActionForm({
  action,
  success,
  confirm,
  onDone,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<unknown> | unknown;
  success?: string;
  confirm?: string;
  onDone?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        if (confirm && !window.confirm(confirm)) return;
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          try {
            await action(formData);
            if (success) toast.success(success);
            onDone?.();
          } catch (error) {
            toast.error(
              error instanceof Error && error.message
                ? error.message
                : "Something went wrong — try again.",
            );
          }
        });
      }}
    >
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
    </form>
  );
}
