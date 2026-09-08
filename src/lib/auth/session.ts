import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
});

export const getMemberships = cache(async () => {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("organization_members")
    .select("id, organization_id, role, organizations(id,name,slug,default_locale)")
    .eq("user_id", user.id);
  return data ?? [];
});

export async function requireUser(locale: string) {
  const user = await getUser();
  if (!user) {
    const { redirect } = await import("next/navigation");
    redirect(`/${locale}/login`);
  }
  return user;
}
