import type { Env } from "./env";
import { verifyStripeSignature } from "./stripe";
import { markPaymentEnded, markPaymentPaid, markPaymentRefunded, recordStripeEvent, setTransfersActive, stripeEventSeen } from "./db";

interface StripeEvent {
  id: string;
  type: string;
  data: { object: any };
}

/**
 * Stripe webhook for the crew account, including Connect events for crew members' accounts.
 * STRIPE_CREW_WEBHOOK_SECRET can list several signing secrets, comma-separated, since Stripe
 * sends the account's events and the connected accounts' events from separate endpoints.
 */
export async function stripeWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.STRIPE_CREW_WEBHOOK_SECRET) return json({ error: "STRIPE_CREW_WEBHOOK_SECRET is not set" }, 503);
  const payload = await request.text();
  const signature = request.headers.get("Stripe-Signature");
  const secrets = env.STRIPE_CREW_WEBHOOK_SECRET.split(",").map((secret) => secret.trim()).filter(Boolean);
  let valid = false;
  for (const secret of secrets) valid ||= await verifyStripeSignature(payload, signature, secret);
  if (!valid) return json({ error: "Invalid signature" }, 400);

  const event = JSON.parse(payload) as StripeEvent;
  if (await stripeEventSeen(env, event.id)) return json({ received: true, duplicate: true });

  const object = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      if (object.payment_status === "paid") await markPaymentPaid(env, object.id, object.payment_intent ?? null);
      break;
    case "checkout.session.async_payment_failed":
      await markPaymentEnded(env, object.id, "failed");
      break;
    case "checkout.session.expired":
      await markPaymentEnded(env, object.id, "expired");
      break;
    case "charge.refunded":
      if (object.payment_intent && object.refunded) await markPaymentRefunded(env, object.payment_intent);
      break;
    case "account.updated":
      await setTransfersActive(env, object.id, object.capabilities?.transfers === "active");
      break;
  }

  await recordStripeEvent(env, event.id, event.type);
  return json({ received: true });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
