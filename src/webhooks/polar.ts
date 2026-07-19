import { Request, Response } from "express";
import { getEnv } from "../lib/environment";
import { Webhook } from "standardwebhooks";
import { db } from "../db";
import { checkoutsSession, orderItems, orders } from "../db/schema";
import { eq } from "drizzle-orm";

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

async function alreadyPaid(polarOrderId?: string, checkoutId?: string) {
  if (polarOrderId) {
    const [row] = await db
      .select()
      .from(orders)
      .where(eq(orders.orderId, polarOrderId))
      .limit(1);
    if (row?.status === "paid") return true;
  }
  if (checkoutId) {
    const [row] = await db
      .select()
      .from(orders)
      .where(eq(orders.checkoutId, checkoutId))
      .limit(1);
    if (row?.status === "paid") return true;
  }
  return false;
}

async function fulfillCheckoutSession(
  sessionId: string,
  polarOrderId: string | undefined,
  checkoutId: string | undefined,
) {
  return await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(checkoutsSession)
      .where(eq(checkoutsSession.id, sessionId))
      .for("update");
    if (!session) return false;

    const [order] = await tx
      .insert(orders)
      .values({
        userId: session.userId,
        status: "paid",
        totalAmount: session.totalAmount,
        checkoutId: checkoutId ?? session.polarCheckoutId!,
        createdAt: new Date(),
        currency: "USD",
        ...(polarOrderId ? { orderId: polarOrderId } : {}),
      })
      .returning();

    if (session.lines.length > 0) {
      await tx.insert(orderItems).values(
        session.lines.map((line) => ({
          orderId: order.id,
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.price,
        })),
      );
    }

    await tx.delete(checkoutsSession).where(eq(checkoutsSession.id, sessionId));
    return true;
  });
}

export const polarWebhookHandler = async (req: Request, res: Response) => {
  const loadenv = getEnv();
  try {
    if (!loadenv.POLAR_WEBHOOK_SECRET) {
      res.status(503).send("Polar webhook not configured");
      return;
    }

    const raw =
      req.body instanceof Buffer ? req.body : Buffer.from(String(req.body));
    const wh = new Webhook(
      Buffer.from(loadenv.POLAR_WEBHOOK_SECRET, "utf8").toString("base64"),
    );

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
    wh.verify(raw, {
      "webhook-id": id,
      "webhook-timestamp": ts,
      "webhook-signature": sig,
    });

    const event = JSON.parse(raw.toString("utf8")) as {
      type: string;
      data?: Record<string, unknown>;
    };

    if (event.type === "order.paid" && event.data) {
      const data = event.data;
      const polarOrderId = typeof data.id === "string" ? data.id : undefined;
      const checkoutId =
        typeof data.checkout_id === "string" ? data.checkout_id : undefined;

      if (await alreadyPaid(polarOrderId, checkoutId)) {
        res.json({ success: true, duplicate: true });
        return;
      }
      const sessionId = checkoutSessionFromMetadata(data);

      if (sessionId) {
        const fulfilled = await fulfillCheckoutSession(
          sessionId,
          polarOrderId,
          checkoutId,
        );

        if (fulfilled) {
          return res.json({ success: true });
        }
        if (await alreadyPaid(polarOrderId, checkoutId)) {
          res.json({ success: true, duplicate: true });
          return;
        }

        console.error("Polar oder.paid : could not fulfill checkout session", {
          sessionId,
          checkoutId,
        });
        res.status(500).json({ error: "checkout fullfillment faild" });
        return;
      }
    }
    res.status(200).json({ success: true, message: "Polar payment ok" });

    // catch
  } catch (error) {
    console.log("Polar webhook error", error);
    res.status(400).json({ success: false, message: "Invalid webhook" });
  }
};
