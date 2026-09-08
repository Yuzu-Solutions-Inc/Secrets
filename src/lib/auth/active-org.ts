import { cookies } from "next/headers";

const COOKIE = "secrets-active-org";

export async function getActiveOrganizationId() {
  return (await cookies()).get(COOKIE)?.value ?? null;
}

export async function setActiveOrganizationId(id: string) {
  (await cookies()).set(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
