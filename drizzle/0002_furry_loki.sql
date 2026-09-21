ALTER TABLE "orders" DROP CONSTRAINT "orders_checkout_id_unique";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_order_id_unique";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "display_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "checkout_session_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "polar_checkout_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "polar_order_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_checkout_session_id_checkouts_id_fk" FOREIGN KEY ("checkout_session_id") REFERENCES "public"."checkouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "checkout_id";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "order_id";--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_checkout_session_id_unique" UNIQUE("checkout_session_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_polar_order_id_unique" UNIQUE("polar_order_id");