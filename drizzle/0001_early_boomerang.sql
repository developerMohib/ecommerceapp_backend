ALTER TABLE "checkouts" ALTER COLUMN "checkout_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "checkouts" ALTER COLUMN "unit_amount" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "checkouts" ALTER COLUMN "quantity" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "unit_amount" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "quantity" DROP NOT NULL;