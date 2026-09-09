import type Stripe from "stripe";

import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, stripeEnv } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Events that mean "money received" for our one-time checkouts.
const FULFILL_EVENTS = new Set<Stripe.Event["type"]>([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("missing signature", { status: 400 });

  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, stripeEnv().STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error("[stripe] signature verification failed", error);
    return new Response("invalid signature", { status: 400 });
  }

  const admin = createAdminClient();

  // Already handled? (Stripe retries; completed + async_payment_succeeded can both fire.)
  const { data: seen } = await admin.from("billing_events").select("id").eq("id", event.id).maybeSingle();
  if (seen) return new Response(null, { status: 200 });

  if (FULFILL_EVENTS.has(event.type)) {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.payment_status === "paid") {
      const userId = session.metadata?.user_id;
      const sku = session.metadata?.sku;
      if (userId && (sku === "pro_pack_3" || sku === "pro_unlimited")) {
        // apply_purchase is itself idempotent on the checkout session id.
        const { error } = await admin.rpc("apply_purchase", {
          p_user: userId,
          p_sku: sku,
          p_session: session.id,
          p_payment_intent:
            typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null),
          p_amount: session.amount_total ?? null,
          p_currency: session.currency ?? null,
        });
        if (error) {
          // Don't record the event -> Stripe retries -> we retry fulfillment.
          console.error("[stripe] apply_purchase failed", error);
          return new Response("fulfillment error", { status: 500 });
        }
      } else {
        console.warn("[stripe] checkout session missing user_id/sku metadata", session.id);
      }
    }
  }

  await admin
    .from("billing_events")
    .insert({ id: event.id, type: event.type, payload: event as unknown as Record<string, unknown> });

  return new Response(null, { status: 200 });
}
