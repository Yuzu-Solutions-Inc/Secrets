"use client";

import { Languages } from "lucide-react";
import { useLocale } from "next-intl";
import { useTransition } from "react";

import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

const LABELS: Record<string, string> = { en: "English", fr: "Français" };

export function LocaleSwitcher() {
  const activeLocale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <label className="relative flex items-center">
      <span className="sr-only">Language</span>
      <Languages
        size={16}
        className="pointer-events-none absolute left-2.5 text-pink-600"
        aria-hidden="true"
      />
      <select
        value={activeLocale}
        disabled={isPending}
        onChange={(event) => {
          const locale = event.target.value;
          if (locale === activeLocale) return;
          startTransition(() => {
            router.replace(pathname, { locale });
          });
        }}
        className="min-h-9 appearance-none rounded-full border border-pink-100 bg-white py-1.5 pl-8 pr-7 text-xs font-black text-pink-700 disabled:opacity-60"
      >
        {routing.locales.map((locale) => (
          <option key={locale} value={locale}>
            {LABELS[locale] ?? locale.toUpperCase()}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-2.5 h-3 w-3 text-pink-500"
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M2.5 4.5 6 8l3.5-3.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </label>
  );
}
