ALTER TABLE "companies" ADD COLUMN "legal_name" varchar(160);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "address" varchar(255);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "phone" varchar(30);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "email" varchar(160);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "logo" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "quote_terms" varchar(2000);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "freight" numeric(12, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "other_charges" numeric(12, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "freight" numeric(12, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "other_charges" numeric(12, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "internal_notes" varchar(500);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "site_description" varchar(160);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "site_contact" varchar(160);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "site_address" varchar(255);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "mirror_snapshot" jsonb;