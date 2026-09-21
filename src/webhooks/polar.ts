import { Request, Response } from "express";
import { getEnv } from "../lib/environment";
import { Webhook } from "standardwebhooks";
import { db } from "../db";
import { checkoutsSession, orderItems, orders } from "../db/schema";
import { eq, or } from "drizzle-orm";

function headerString(headers: Request["headers"], name: string) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function checkoutSessionFromMetadata(order: Record<string, unknown>) {
  const metadata = order.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  const sessionId = (metadata as Record<string, unknown>).checkout_session_id;
  return typeof sessionId === "string" ? sessionId : undefined;
}

async function orderAlreadyExists(polarOrderId?: string, checkoutId?: string) {
  if (polarOrderId) {
    const [row] = await db
      .select()
      .from(orders)
      .where(eq(orders.polarOrderId, polarOrderId))
      .limit(1);
    if (row?.status === "paid") return true;
  }
  if (checkoutId) {
    const [row] = await db
      .select()
      .from(orders)
      .where(eq(orders.polarCheckoutId, checkoutId))
      .limit(1);
    if (row?.status === "paid") return true;
  }
  return false;
}

async function fulfillCheckoutSession(
  sessionId: string | undefined,
  polarOrderId: string | undefined,
  checkoutId: string | undefined,
) {
  return await db.transaction(async (tx) => {
    const sessionWhere = sessionId
      ? eq(checkoutsSession.id, sessionId)
      : checkoutId
        ? eq(checkoutsSession.polarCheckoutId, checkoutId)
        : undefined;

    if (!sessionWhere) return false;

    const [session] = await tx
      .select()
      .from(checkoutsSession)
      .where(sessionWhere)
      .for("update");

    if (!session) {
      // A successfully fulfilled session is retained for order history. A missing
      // session means the webhook refers to an invalid or already-removed record.
      return false;
    }

    const finalCheckoutId = checkoutId ?? session.polarCheckoutId;

    if (!finalCheckoutId) {
      throw new Error("Missing Polar checkout ID");
    }

    // The webhook provider can deliver the same event more than once. The row
    // lock serializes deliveries and this check makes the transaction safe to
    // retry without relying on a pre-transaction read.
    const existingOrder = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(
        or(
          eq(orders.checkoutSessionId, session.id),
          eq(orders.polarCheckoutId, finalCheckoutId),
          ...(polarOrderId ? [eq(orders.polarOrderId, polarOrderId)] : []),
        ),
      )
      .limit(1);

    if (existingOrder.length > 0) {
      return true;
    }

    const [order] = await tx
      .insert(orders)
      .values({
        userId: session.userId,
        status: "paid",
        checkoutSessionId: session.id,
        totalAmount: session.totalAmount,
        polarCheckoutId: finalCheckoutId,
        createdAt: new Date(),
        currency: "USD",
        ...(polarOrderId ? { polarOrderId } : {}),
      })
      .returning();

    if (session.lines.length) {
      await tx.insert(orderItems).values(
        session.lines.map((line) => ({
          orderId: order.id,
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
      );
    }

    // Keep the checkout as the immutable payment-attempt record. orders.checkout
    // references it, so deleting it here would violate the foreign key and roll
    // back the entire transaction.
    return true;
  });
}

export const polarWebhookHandler = async (req: Request, res: Response) => {
  console.log("polar webhook handler test 100");
  console.log("polar webhook handler", req.body);

  const loadenv = getEnv();
  try {
    if (!loadenv.POLAR_WEBHOOK_SECRET) {
      res.status(503).send("Polar webhook not configured");
      return;
    }

    const raw =
      req.body instanceof Buffer ? req.body : Buffer.from(String(req.body));

    // const wh = new Webhook(loadenv.POLAR_WEBHOOK_SECRET);
    const wh = new Webhook(
      Buffer.from(loadenv.POLAR_WEBHOOK_SECRET, "utf8").toString("base64"),
    );

    console.log("raw", raw);
    const id = headerString(req.headers, "webhook-id");
    const ts = headerString(req.headers, "webhook-timestamp");
    const sig = headerString(req.headers, "webhook-signature");

    if (!id || !ts || !sig) {
      res.status(400).json({
        success: false,
        message: "Missing webhook headers",
      });
      return;
    }
    try {
      wh.verify(raw, {
        "webhook-id": id,
        "webhook-timestamp": ts,
        "webhook-signature": sig,
      });
    } catch {
      res.status(401).json({ success: false, message: "Invalid signature" });
      return;
    }

    const event = JSON.parse(raw.toString("utf8")) as {
      type: string;
      data?: Record<string, unknown>;
    };
    console.log("event", event);
    if (event.type === "order.paid" && event.data) {
      const data = event.data;
      const polarOrderId = typeof data.id === "string" ? data.id : undefined;
      const checkoutId =
        typeof data.checkout_id === "string" ? data.checkout_id : undefined;

      if (await orderAlreadyExists(polarOrderId, checkoutId)) {
        res.json({ success: true, duplicate: true });
        return;
      }
      // Metadata is useful, but the checkout ID is the durable correlation key:
      // Polar order payloads do not require checkout metadata to be present.
      const sessionId = checkoutSessionFromMetadata(data);
      console.log("Metadata:", data.metadata);
      console.log("Session ID:", sessionId);
      if (sessionId || checkoutId) {
        const fulfilled = await fulfillCheckoutSession(
          sessionId,
          polarOrderId,
          checkoutId,
        );

        if (fulfilled) {
          return res.json({ success: true });
        }
        if (await orderAlreadyExists(polarOrderId, checkoutId)) {
          res.json({ success: true, duplicate: true });
          return;
        }
        res.status(500).json({ error: "checkout fulfillment failed" });
        return;
      }

      // Do not acknowledge a paid event that cannot be correlated. A 2xx would
      // prevent Polar from retrying and would leave payment without an order.
      res.status(500).json({ error: "Paid order has no checkout correlation" });
      return;
    }
    res.status(200).json({ success: true, message: "Polar payment ok" });
  } catch (error) {
    console.error("========== POLAR WEBHOOK ERROR ==========");
    console.error(error);
    console.error("==========================================");

    res.status(500).json({
      success: false,
      message: "Webhook processing failed",
    });
  }
};
