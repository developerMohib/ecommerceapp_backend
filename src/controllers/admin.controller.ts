import { getAuth } from "@clerk/express";
import { NextFunction, Request, Response } from "express";
import { getLocalUser } from "../lib/users";
import { isAdmin } from "../lib/roles";
import ImageKit from "@imagekit/nodejs";
import { getEnv } from "../lib/environment";
import { db } from "../db";
import { orderItems, products } from "../db/schema";
import { desc, eq, count } from "drizzle-orm";
import z from "zod";
import { deleteImageKitAsset } from "../lib/imagekit";
const envload = getEnv();

export const productCreate = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),

  category: z.string().min(1).default("General"),
  description: z.string().default(""),

  price: z.number().int().nonnegative(),
  currency: z.string().min(1).default("USD"),

  imageUrl: z
    .union([z.string().url(), z.literal(""), z.null()])
    .optional()
    .nullable(),

  imageKitFileId: z
    .union([z.string().min(1), z.literal(""), z.null()])
    .optional()
    .nullable(),

  isActive: z.boolean().default(true),

  stock: z.number().int().nonnegative().default(0),
});

const productPatch = productCreate.partial();
function buildProductUpdates(body: z.infer<typeof productPatch>) {
  const data: Partial<typeof products.$inferInsert> = {};
  if (body.slug !== undefined) data.slug = body.slug;
  if (body.name !== undefined) data.name = body.name;
  if (body.category !== undefined) data.category = body.category;
  if (body.description !== undefined) data.description = body.description;
  if (body.price !== undefined) data.price = body.price;
  if (body.currency !== undefined) data.currency = body.currency;

  if (body.imageUrl !== undefined) {
    data.imageUrl = body.imageUrl === "" ? null : body.imageUrl;
  }

  if (body.imageKitFileId !== undefined) {
    data.imageKitFileId =
      body.imageKitFileId === "" ? null : body.imageKitFileId;
  }

  if (body.isActive !== undefined) data.isActive = body.isActive;
  if (body.stock !== undefined) data.stock = body.stock;
  return data;
}

export const requiredAdmin = async (
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
    const user = await getLocalUser(userId);
    if (!isAdmin(user.role)) {
      res.status(403).json({ error: "Admin Only" });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};

export const getImageKitAuth = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const client = new ImageKit({
      privateKey: envload.IMAGEKIT_PRIVATE_KEY,
    });
    const auth = client.helper.getAuthenticationParameters();

    res.json({
      ...auth,
      publicKey: envload.IMAGEKIT_PUBLIC_KEY,
      urlEndpoint: envload.IMAGEKIT_URL_ENDPOINT,
    });
  } catch (error) {
    next(error);
  }
};

export const listAdminProducts = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const rows = await db
      .select()
      .from(products)
      .orderBy(desc(products.createdAt));
    res.status(200).json({
      success: true,
      message: "Admin product retrive successfully",
      data: rows,
    });
  } catch (error) {
    next(error);
  }
};

export const createAdminProduct = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const parsed = productCreate.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid body",
        details: parsed.error.flatten(),
      });
      return;
    }
    const uniqueSlug = `${parsed.data.slug}-${Date.now()}`;
    const { imageUrl, imageKitFileId, ...rest } = parsed.data;
    const [row] = await db
      .insert(products)
      .values({
        ...rest,
        slug: uniqueSlug,
        imageUrl: imageUrl || null,
        imageKitFileId: imageKitFileId || null,
      })
      .returning();

    res.status(200).json({
      success: true,
      message: "Admin product create successfully",
      data: row,
    });
  } catch (error) {
    next(error);
  }
};

export const updateAdminProduct = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const parsed = productPatch.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid body",
        details: parsed.error.flatten(),
      });
      return;
    }
    const data = buildProductUpdates(parsed.data);

    if (Object.keys(data).length === 0) {
      res.status(400).json({ success: false, message: "No fields to update" });
      return;
    }

    const [row] = await db
      .update(products)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(products.id, req.params.id as string))
      .returning();

    if (!row) {
      res.status(400).json({ success: false, message: "Not Found" });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Admin product update successfully",
      data: row,
    });
  } catch (error) {
    next(error);
  }
};
export const deleteAdminProduct = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;

    if (!id) {
      res.status(400).json({
        success: false,
        message: "Missing product id",
      });
      return;
    }
    const [existing] = await db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    if (!existing) {
      res.status(404).json({
        success: false,
        message: "Product Not Found",
      });
      return;
    }

    const [countRow] = await db
      .select({ c: count() })
      .from(orderItems)
      .where(eq(orderItems.productId, id));
    if (Number(countRow?.c ?? 0) > 0) {
      res.status(409).json({
        success: false,
        message:
          "This product is on one or more orders and cannot be deleted. Deactivate it instead",
      });
      return;
    }
    await deleteImageKitAsset(envload, existing.imageKitFileId);
    await db.delete(products).where(eq(products.id, id));
    res.status(200).json({
      success: true,
      message: "Admin product delete successfully",
    });
  } catch (error) {
    next(error);
  }
};
