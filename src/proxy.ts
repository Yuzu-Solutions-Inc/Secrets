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
  matcher: ["/((?!api|auth|_next|_vercel|.*\\..*).*)"],
};
