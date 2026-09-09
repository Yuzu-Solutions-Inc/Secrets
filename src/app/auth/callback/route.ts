import { hasLocale } from "next-intl";
import { NextResponse, type NextRequest } from "next/server";

import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value;
  const locale = hasLocale(routing.locales, cookieLocale)
    ? cookieLocale
    : routing.defaultLocale;
  const fallback = `/${locale}/games`;

  const requested = url.searchParams.get("next");
  const next =
    requested && requested.startsWith("/") && !requested.startsWith("//")
      ? requested
      : fallback;

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
