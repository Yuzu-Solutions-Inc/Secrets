import { setRequestLocale } from "next-intl/server";

import { AuthForm } from "@/components/auth/auth-form";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ mode?: string; next?: string }>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);

  return (
    <main className="grid min-h-dvh place-items-center px-5 py-10">
      <AuthForm
        locale={locale}
        initialMode={query.mode === "signup" ? "signup" : "signin"}
        next={query.next?.startsWith(`/${locale}/`) ? query.next : undefined}
      />
    </main>
  );
}
