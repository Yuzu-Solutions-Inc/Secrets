import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import {
  type Entitlement,
  FREE_ENTITLEMENT,
  type EntitlementSummary,
  describeEntitlement,
} from "./plan";

/** The signed-in user's entitlement row (Free default if none / not signed in). */
export const getEntitlement = cache(async (): Promise<Entitlement> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("current_entitlement");
  if (error || !data) return FREE_ENTITLEMENT;
  return data as Entitlement;
});

export async function getEntitlementSummary(): Promise<EntitlementSummary> {
  return describeEntitlement(await getEntitlement(), new Date());
}
