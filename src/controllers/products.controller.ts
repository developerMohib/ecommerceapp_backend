import { and, desc, eq } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import { products } from "../db/schema";
import { db } from "../db";

export const listProducts = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const cat =
      typeof req.query.category === "string" ? req.query.category.trim() : "";
    const activeOnly = eq(products.isActive, true);
    const whereClause = cat
      ? and(activeOnly, eq(products.category, cat))
      : activeOnly;

    const rows = await db
      .select()
      .from(products)
      .where(whereClause)
      .orderBy(desc(products.createdAt));
    res.status(200).json({
      success: true,
      message: "Products Retrieved Successfully",
      data: rows,
    });
  } catch (error) {
    next(error);
  }
};
export const getCategoriesProducts = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const rows = await db
      .select({ category: products.category })
      .from(products)
      .where(eq(products.isActive, true));

    const categories = [...new Set(rows.map((r) => r.category))].sort((a, b) =>
      a.localeCompare(b),
    );
    res.status(200).json({
      success: true,
      message: "Products Retrive successfully by category",
      data: categories,
    });
  } catch (error) {
    next(error);
  }
};
export const getProductsBySlug = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const [row] = await db
      .select()
      .from(products)
      .where(eq(products.slug, req.params.slug as string))
      .limit(1);
    if (!row || !row.isActive) {
      res
        .status(404)
        .json({ success: false, message: "Product not found", data: [] });
        return
    }
     res
        .status(200)
        .json({ success: true, message: "Product Retrived Successfully", data: row});
  } catch (error) {
    next(error);
  }
};
