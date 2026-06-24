// POST /api/webhooks/stripe
//
// Stripe webhook receiver. Processes events asynchronously (fire-and-forget
// after returning 200) to respect Stripe's 30-second delivery timeout.
//
// Signature verification note: the raw body is captured for future HMAC
// verification via `stripe.webhooks.constructEvent()` once the `stripe` SDK
// is installed and `STRIPE_WEBHOOK_SECRET` is set. Until then, events are
// logged and processed without signature verification — add verification
// before going live.
//
// To fully verify in production:
//   import Stripe from "stripe";
//   const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
//   const event = stripe.webhooks.constructEvent(rawBody, sig, secret);

import { NextRequest, NextResponse } from "next/server";

// Stripe sends a raw body for signature verification; must use nodejs runtime.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers.get("stripe-signature");

  if (!secret || !sig) {
    return NextResponse.json(
      { error: "Missing webhook config" },
      { status: 400 },
    );
  }

  const rawBody = await req.text();

  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody) as {
      type: string;
      data: { object: Record<string, unknown> };
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Return 200 immediately; process the event asynchronously.
  void processStripeEvent(event).catch(console.error);
  return NextResponse.json({ received: true });
}

async function processStripeEvent(event: {
  type: string;
  data: { object: Record<string, unknown> };
}) {
  const obj = event.data.object;
  switch (event.type) {
    case "checkout.session.completed": {
      const tenantId = obj["metadata"]
        ? (obj["metadata"] as Record<string, string>)["tenantId"]
        : "unknown";
      console.log(
        "[stripe] checkout completed:",
        obj["id"],
        "tenant:",
        tenantId,
      );
      // TODO: mark order as paid, send WhatsApp confirmation.
      // The order ref is in metadata.planKey when planKey === "invoice".
      // Cross-reference with the pay/[ref] POST handler pattern.
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      console.log("[stripe] subscription event:", event.type, obj["id"]);
      // TODO: update Subscription record in DB (provider="stripe",
      // providerSubscriptionId=obj["id"]).
      break;
    }

    case "customer.subscription.deleted": {
      console.log("[stripe] subscription cancelled:", obj["id"]);
      // TODO: downgrade tenant to free plan.
      break;
    }

    case "invoice.payment_succeeded": {
      console.log("[stripe] invoice paid:", obj["id"]);
      // TODO: renew subscription period, update currentPeriodEnd.
      break;
    }

    case "invoice.payment_failed": {
      console.log("[stripe] invoice payment failed:", obj["id"]);
      // TODO: mark subscription as past_due.
      break;
    }

    default:
      console.log("[stripe] unhandled event:", event.type);
  }
}
