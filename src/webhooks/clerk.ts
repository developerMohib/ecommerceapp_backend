import { Request, Response } from "express";
import { verifyWebhook } from "@clerk/express/webhooks";
import { getEnv } from "../lib/environment";
import { parseRole } from "../lib/roles";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";


export const clerkWebhookHandler = async (req: Request, res: Response) => {
  const envload = getEnv();
  try {
    if (!envload.CLERK_WEBHOOK_SECRET) {
      res.status(503).json({
        success: false,
        message: "Webhooks secret is not provided",
      });
      return;
    }

    const evt = await verifyWebhook(req, {
      signingSecret: envload.CLERK_WEBHOOK_SECRET,
    });

    if (evt.type === "user.created" || evt.type === "user.updated") {
      const u = evt.data;

      const email =
        u.email_addresses?.find((e) => e.id === u.primary_email_address_id)
          ?.email_address ?? u.email_addresses?.[0]?.email_address;

      if (!email) {
        res.status(400).json({ success: false, message: "User missing email" });
        return;
      }

      const displayName =
        [u.first_name, u.last_name].filter(Boolean).join(" ") ||
        u.username ||
        email;

      const role = parseRole(u.public_metadata?.role);

      await db
        .insert(users)
        .values({
          clerkUserId: u.id,
          email,
          displayName,
          role,
        })
        .onConflictDoUpdate({
          target: users.clerkUserId,
          set: { email, displayName, role, updatedAt: new Date() },
        });
    }
    if (evt.type === "user.deleted") {
      const id = evt.data.id;

      if (id) {
        await db.delete(users).where(eq(users.clerkUserId, id));
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
        res.status(400).json({ success: false, message: "Invalid webhook" });
  }
};
