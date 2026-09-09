import "server-only";

import Stripe from "stripe";
import { z } from "zod";

import type { Sku } from "./plan";

const schema = z.object({
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRICE_PRO_PACK: z.string().min(1),
  STRIPE_PRICE_PRO_UNLIMITED: z.string().min(1),
});

export function stripeEnv() {
  return schema.parse({
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_PRO_PACK: process.env.STRIPE_PRICE_PRO_PACK,
    STRIPE_PRICE_PRO_UNLIMITED: process.env.STRIPE_PRICE_PRO_UNLIMITED,
  });
}

export function priceIdForSku(sku: Sku): string {
  const env = stripeEnv();
  return sku === "pro_pack_3" ? env.STRIPE_PRICE_PRO_PACK : env.STRIPE_PRICE_PRO_UNLIMITED;
}

let client: Stripe | undefined;

export function getStripe(): Stripe {
  client ??= new Stripe(stripeEnv().STRIPE_SECRET_KEY, {
    appInfo: { name: "secrets-game" },
  });
  return client;
}
