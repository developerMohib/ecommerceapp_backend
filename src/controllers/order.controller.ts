import { getAuth } from "@clerk/express";
import { NextFunction, Request, Response } from "express";
import { getLocalUser } from "../lib/users";
import { isStaff } from "../lib/roles";
import { db } from "../db";
import { orderItems, orders, products, users } from "../db/schema";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { getEnv } from "../lib/environment";
import {
  getStreamChatServer,
  streamChatDisplayName,
  streamUserId,
} from "../lib/stream";

const env = getEnv();

export const listOrders = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { userId, isAuthenticated } = getAuth(req);
    if (!userId || !isAuthenticated) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const localUser = await getLocalUser(userId);
    if (!localUser) {
      res
        .status(503)
        .json({ success: false, message: "Account not synced yet" });
      return;
    }
    const rows = isStaff(localUser.role)
      ? await db.select().from(orders).orderBy(desc(orders.createdAt))
      : await db
          .select()
          .from(orders)
          .where(eq(orders.userId, localUser.id))
          .orderBy(desc(orders.createdAt));

    const orderIds = rows.map((r) => r.id);
    const previewByOrder = new Map();
    if (orderIds.length > 0) {
      const itemRows = await db
        .select({
          orderId: orderItems.orderId,
          quantity: orderItems.quantity,
          name: products.name,
          slug: products.slug,
          imageUrl: products.imageUrl,
        })
        .from(orderItems)
        .innerJoin(products, eq(orderItems.productId, products.id))
        .where(inArray(orderItems.orderId, orderIds))
        .orderBy(asc(orderItems.id));

      for (const row of itemRows) {
        const list = previewByOrder.get(row.orderId) ?? [];
        list.push({
          name: row.name,
          slug: row.slug,
          imageUrl: row.imageUrl,
          quantity: row.quantity,
        });
        previewByOrder.set(row.orderId, list);
      }
    }

    const ordersPayload = rows.map((o) => ({
      ...o,
      previewItems: previewByOrder.get(o.id) ?? [],
    }));

    res.status(200).json({
      success: true,
      message: "Order retrive successfully",
      data: ordersPayload,
    });
  } catch (error) {
    next(error);
  }
};

export const getOrderDetails = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { userId, isAuthenticated } = getAuth(req);
    if (!userId || !isAuthenticated) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const localUser = await getLocalUser(userId);
    if (!localUser) {
      res
        .status(503)
        .json({ success: false, message: "Account not synced yet" });
      return;
    }

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, req.params.id as string))
      .limit(1);
    if (!order) {
      res.status(404).json({ success: false, message: "Order Not found" });
      return;
    }

    const canAccess = order.userId === localUser.id || isStaff(localUser.role);
    if (!canAccess) {
      res.status(404).json({ success: false, message: "Order Not found" });
      return;
    }

    const items = await db
      .select({
        id: orderItems.id,
        quantity: orderItems.quantity,
        price: orderItems.unitPrice,
        product: products,
      })
      .from(orderItems)
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(eq(orderItems.orderId, order.id));

    res.status(200).json({ success: true, data: { items, order } });
  } catch (error) {
    next(error);
  }
};

export const createStreamChannel = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { userId, isAuthenticated } = getAuth(req);
    if (!userId || !isAuthenticated) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const server = getStreamChatServer(env);
    const localUser = await getLocalUser(userId);
    if (!localUser) {
      res
        .status(503)
        .json({ success: false, message: "Account not synced yet" });
      return;
    }
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, req.params.id as string))
      .limit(1);
    if (!order) {
      res.status(404).json({ success: false, message: "Order Not found" });
      return;
    }
    const isOwner = order.userId === localUser.id;
    if (!isOwner && !isStaff(localUser.role)) {
      res.status(404).json({ success: false, message: "Not found" });
      return;
    }
    if (order.status !== "paid") {
      res.status(403).json({
        success: false,
        message: "Order must be paid to open suport chat",
      });
      return;
    }

    const streamChatUserId = streamUserId(userId);
    await server.upsertUser({
      id: streamChatUserId,
      name: streamChatDisplayName(
        localUser.role,
        localUser.displayName,
        localUser.email,
      ),
    });

    const channelId = `order-${order.id}`;
    const channel = server.channel("messaging", channelId, {
      name: `Support - order ${order.id.slice(0, 8)}`,
      created_by_id: streamChatUserId,
    });
    await channel.create().catch(() => {});
    await channel.addMembers([streamChatUserId]);
    res.json({
      channelType: "messaging",
      channelId,
      streamUserId: streamChatUserId,
    });
  } catch (error) {
    next(error);
  }
};

export const createVideoInvite = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { userId, isAuthenticated } = getAuth(req);
    if (!userId || !isAuthenticated) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const server = getStreamChatServer(env);
    const localUser = await getLocalUser(userId);
    if (!localUser) {
      res
        .status(403)
        .json({ success: false, message: "Account not synced yet" });
      return;
    }

    if (!isStaff(localUser.role)) {
      res.status(404).json({
        success: false,
        message: "Only Support can create video call invitation",
      });
      return;
    }
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, req.params.id as string))
      .limit(1);
    if (!order || order.status !== "paid") {
      res.status(404).json({ success: false, message: "Order Not found" });
      return;
    }

    const [owner] = await db
      .select()
      .from(users)
      .where(eq(users.id, order.userId))
      .limit(1);
    if (!owner) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }
    const customerSid = streamUserId(owner.clerkUserId);

    await server.upsertUser({
      id: customerSid,
      name: owner.displayName ?? owner.email ?? "Customer",
    });

    const staffStreamChatUserId = streamUserId(userId);
    await server.upsertUser({
      id: staffStreamChatUserId,
      name: streamChatDisplayName(
        localUser.role,
        localUser.displayName,
        localUser.email,
      ),
    });

    const channelId = `order-${order.id}`;
    const channel = server.channel("messaging", channelId, {
      name: `Name: Support - order ${order.id.slice(0, 8)}`,
      created_by_id: staffStreamChatUserId,
    });

    await channel.create().catch(() => {});
    await channel.addMembers([customerSid, staffStreamChatUserId]);

    const joinUrl = `${env.FRONTEND_URL?.replace(/\/+$/, "")}/orders/${order.id}/call`;
    await channel.sendMessage({
      text: `Video call - tap join below (same link for everyone): ${joinUrl}`,
      user_id: staffStreamChatUserId,
      custom: { video_intvie: true, url: joinUrl },
    });

    res.json({
      success: true,
      url: joinUrl,
    });
  } catch (error) {
    next(error);
  }
};
export const test = async (req: Request, res: Response, next: NextFunction) => {
  try {
    //
  } catch (error) {
    next(error);
  }
};
