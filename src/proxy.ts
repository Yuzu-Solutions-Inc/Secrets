import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";
import { routing } from "@/i18n/routing";

const intlMiddleware = createMiddleware(routing);

export default async function proxy(request: NextRequest) {
  const response = intlMiddleware(request);
  return updateSession(request, response);
}

export const config = {
  // `icon` and `apple-icon` are root-level metadata routes (no file extension),
  // so they must be excluded here or next-intl redirects them to /<locale>/icon.
  matcher: ["/((?!api|auth|_next|_vercel|icon|apple-icon|.*\\..*).*)"],
};
