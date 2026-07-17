import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";
export type OrderStatus = "pending" | "paid" | "failed";
export type UserRole = "customer" | "admin" | "support";
export type CheckoutSessionLine = {
  productId: string;
  quantity: number;
  price: number;
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  role: text("role").$type<UserRole>().notNull().default("customer"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull().default("General"),
  description: text("description").notNull().default(""),
  price: integer("price").notNull(),
  currency: text("currency").notNull().default("USD"),
  imageUrl: text("image_url"),
  imageKitFileId: text("imagekit_file_id"),
  isActive: boolean("active").notNull().default(true),
  stock: integer("stock").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const checkoutsSession = pgTable("checkouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  checkoutId: text("checkout_id").notNull().unique(),
  lines: jsonb("lines").$type<CheckoutSessionLine[]>().notNull(),
  unitAmount: integer("unit_amount").notNull(),
  quantity: integer("quantity").notNull(),
  totalAmount: integer("total_amount").notNull(),
  currency: text("currency").notNull().default("USD"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").$type<OrderStatus>().notNull().default("pending"),
  checkoutId: text("checkout_id").notNull().unique(),
  orderId: text("order_id").notNull().unique(),
  unitAmount: integer("unit_amount").notNull(),
  quantity: integer("quantity").notNull(),
  totalAmount: integer("total_amount").notNull(),
  currency: text("currency").notNull().default("USD"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const orderItems = pgTable("order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
  unitPrice: integer("unit_per_price").notNull(),
});

// user can order many in one time
export const userRelations = relations(users, ({ many }) => ({
  orders: many(orders),
}));

// the same product can show up on many order lines
export const productRelations = relations(products, ({ many }) => ({
  orderItems: many(orderItems),
}));

// each order belongs to exactly one user; each order can have many line items
export const orderRelations = relations(orders, ({ one, many }) => ({
  items: many(orderItems),
  user: one(users, { fields: [orders.userId], references: [users.id] }),
}));

// each line item is for exactly one order and one product
export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
}));
