import { NextFunction, Request, Response } from "express";
import { getEnv } from "../lib/environment";
import z from "zod";
import { getAuth } from "@clerk/express";
import { getLocalUser } from "../lib/users";
import { db } from "../db";
import { CheckoutSessionLine, checkoutsSession, products } from "../db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { polarCreateCheckout } from "../lib/polar";
const envLoad = getEnv();
const cartSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
});

export const createCheckout = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { isAuthenticated, userId } = getAuth(req);
    if (!isAuthenticated || !userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const parsed = cartSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid cart", details: parsed.error.flatten() });
      return;
    }

    // polar access token is required
    if (!envLoad.POLAR_ACCESS_TOKEN) {
      res.status(503).json({ error: "Payments are not configured" });
      return;
    }

    const localUser = await getLocalUser(userId);
    if (!localUser) {
      res.status(503).json({ error: "Account not synced yet" });
      return;
    }
    const ids = parsed.data.items.map((i) => i.productId);

    // load every cart product that exists, is active, and matches the IDs we asked for.
    const prodRows = await db
      .select()
      .from(products)
      .where(and(inArray(products.id, ids), eq(products.isActive, true)));

    if (prodRows.length !== ids.length) {
      res.status(400).json({ error: "One or more products are invalid" });
      return;
    }

    const byId = new Map(prodRows.map((p) => [p.id, p]));
    let totalAmount = 0;
    const lines: CheckoutSessionLine[] = [];

    for (const line of parsed.data.items) {
      const p = byId.get(line.productId)!;
      totalAmount += p.price * line.quantity;
      lines.push({
        productId: p.id,
        quantity: line.quantity,
        unitPrice: p.price,
      });
    }

    if (totalAmount < 10) {
      res.status(400).json({
        error:
          "Total below Polar minimum (e.g. USD requires at least 10 cents)",
      });
      return;
    }
    const [session] = await db
      .insert(checkoutsSession)
      .values({
        userId: localUser.id,
        lines,
        totalAmount,
        currency: "usd",
      })
      .returning();
    const successUrl = `${envLoad.FRONTEND_URL}/checkout/return?checkout_id={CHECKOUT_ID}`;
    const returnUrl = `${envLoad.FRONTEND_URL}/cart`;

    const checkout = await polarCreateCheckout(envLoad, {
      products: [envLoad.POLAR_CHECKOUT_PRODUCT_ID],
      prices: {
        [envLoad.POLAR_CHECKOUT_PRODUCT_ID]: [
          {
            amount_type: "fixed",
            price_currency: "usd",
            price_amount: totalAmount,
          },
        ],
      },

      success_url: successUrl,
      return_url: returnUrl,
      external_customer_id: userId,
      metadata: { checkout_session_id: session.id },
    });
    console.log("polar checkout created test 116");
    console.log("polar checkout created", checkout);
    await db
      .update(checkoutsSession)
      .set({ polarCheckoutId: checkout.id })
      .where(eq(checkoutsSession.id, session.id));

    res.json({ checkoutUrl: checkout.url });
  } catch (error) {
    console.log(error);
    next(error);
  }
};
