import { Request, Response } from "express";
import { eq, or } from "drizzle-orm";
import { Webhook } from "standardwebhooks";
import { db } from "../db";
import { checkoutsSession, orderItems, orders } from "../db/schema";
import { getEnv } from "../lib/environment";

// Types
interface PolarOrderPayload {
  id?: string;
  checkout_id?: string;
  metadata?: Record<string, unknown>;
}

interface WebhookEvent {
  type: string;
  data?: PolarOrderPayload;
}

// Helper Functions
function getHeaderString(headers: Request["headers"], name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function extractCheckoutSessionId(metadata?: Record<string, unknown>): string | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const sessionId = metadata.checkout_session_id;
  return typeof sessionId === "string" ? sessionId : undefined;
}

async function isOrderAlreadyPaid(polarOrderId?: string, checkoutId?: string): Promise<boolean> {
  if (polarOrderId) {
    const [row] = await db
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.polarOrderId, polarOrderId))
      .limit(1);

    if (row?.status === "paid") return true;
  }

  if (checkoutId) {
    const [row] = await db
      .select({ status: orders.status })
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
  checkoutId: string | undefined
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const sessionWhere = sessionId
      ? eq(checkoutsSession.id, sessionId)
      : checkoutId
        ? eq(checkoutsSession.polarCheckoutId, checkoutId)
        : undefined;

    if (!sessionWhere) return false;

    // Lock and retrieve the checkout session
    const [session] = await tx
      .select()
      .from(checkoutsSession)
      .where(sessionWhere)
      .for("update");

    if (!session) return false;

    const finalCheckoutId = checkoutId ?? session.polarCheckoutId;
    if (!finalCheckoutId) {
      throw new Error("Missing Polar checkout ID");
    }

    // Idempotency check inside transaction
    const existingOrder = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(
        or(
          eq(orders.checkoutSessionId, session.id),
          eq(orders.polarCheckoutId, finalCheckoutId),
          ...(polarOrderId ? [eq(orders.polarOrderId, polarOrderId)] : [])
        )
      )
      .limit(1);

    if (existingOrder.length > 0) return true;

    // Create order
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

    // Create line items
    if (session.lines?.length) {
      await tx.insert(orderItems).values(
        session.lines.map((line) => ({
          orderId: order.id,
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        }))
      );
    }

    return true;
  });
}

// Main Webhook Handler
export const polarWebhookHandler = async (req: Request, res: Response): Promise<void> => {
  const env = getEnv();

  if (!env.POLAR_WEBHOOK_SECRET) {
    res.status(503).send("Polar webhook not configured");
    return;
  }

  try {
    // 1. Extract Headers & Payload
    const rawBody = req.body instanceof Buffer ? req.body : Buffer.from(String(req.body));
    const webhookId = getHeaderString(req.headers, "webhook-id");
    const webhookTimestamp = getHeaderString(req.headers, "webhook-timestamp");
    const webhookSignature = getHeaderString(req.headers, "webhook-signature");

    if (!webhookId || !webhookTimestamp || !webhookSignature) {
      res.status(400).json({ success: false, message: "Missing webhook headers" });
      return;
    }

    // 2. Verify Signature
    const secret = Buffer.from(env.POLAR_WEBHOOK_SECRET, "utf-8").toString("base64");
    const wh = new Webhook(secret);

    try {
      wh.verify(rawBody, {
        "webhook-id": webhookId,
        "webhook-timestamp": webhookTimestamp,
        "webhook-signature": webhookSignature,
      });
    } catch {
      res.status(401).json({ success: false, message: "Invalid signature" });
      return;
    }

    // 3. Process Event
    const event = JSON.parse(rawBody.toString("utf8")) as WebhookEvent;

    if (event.type === "order.paid" && event.data) {
      const data = event.data;
      const polarOrderId = typeof data.id === "string" ? data.id : undefined;
      const checkoutId = typeof data.checkout_id === "string" ? data.checkout_id : undefined;

      // Duplicate check before fulfilling
      if (await isOrderAlreadyPaid(polarOrderId, checkoutId)) {
        res.json({ success: true, duplicate: true });
        return;
      }

      const sessionId = extractCheckoutSessionId(data.metadata);

      if (sessionId || checkoutId) {
        const fulfilled = await fulfillCheckoutSession(sessionId, polarOrderId, checkoutId);

        if (fulfilled) {
          res.json({ success: true });
          return;
        }

        // Re-check for duplicate if fulfillment returned false
        if (await isOrderAlreadyPaid(polarOrderId, checkoutId)) {
          res.json({ success: true, duplicate: true });
          return;
        }

        res.status(500).json({ error: "Checkout fulfillment failed" });
        return;
      }

      res.status(500).json({ error: "Paid order has no checkout correlation" });
      return;
    }

    res.status(200).json({ success: true, message: "Polar event processed" });
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