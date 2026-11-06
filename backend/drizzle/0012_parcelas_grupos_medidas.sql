ALTER TABLE "companies" ADD COLUMN "use_measures" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_items" ADD COLUMN "group_name" varchar(80);--> statement-breakpoint
ALTER TABLE "quote_items" ADD COLUMN "width" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "quote_items" ADD COLUMN "length" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "installments" jsonb DEFAULT '[]'::jsonb NOT NULL;