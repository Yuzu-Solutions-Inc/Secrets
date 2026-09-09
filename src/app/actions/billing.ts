"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getEntitlement } from "@/lib/billing/entitlement";
import { getStripe, priceIdForSku } from "@/lib/billing/stripe";
import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  sku: z.enum(["pro_pack_3", "pro_unlimited"]),
  locale: z.enum(["en", "fr"]).default("fr"),
});

function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export async function startCheckout(formData: FormData) {
  const { sku, locale } = schema.parse(Object.fromEntries(formData));

  const user = await getUser();
  if (!user) redirect(`/${locale}/login`);

  const stripe = getStripe();
  const entitlement = await getEntitlement();

  let customerId = entitlement.stripe_customer_id ?? undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { user_id: user.id },
    });
    customerId = customer.id;
    const supabase = await createClient();
    await supabase.rpc("set_stripe_customer_id", { p_customer_id: customerId });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [{ price: priceIdForSku(sku), quantity: 1 }],
    client_reference_id: user.id,
    metadata: { user_id: user.id, sku },
    payment_intent_data: { metadata: { user_id: user.id, sku } },
    allow_promotion_codes: true,
    success_url: `${appUrl()}/${locale}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl()}/${locale}/billing`,
  });

  if (!session.url) throw new Error("checkout_session_missing_url");
  redirect(session.url);
}
