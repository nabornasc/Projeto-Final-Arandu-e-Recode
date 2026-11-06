ALTER TABLE "companies" ADD COLUMN "measure_unit" varchar(2) DEFAULT 'm' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_items" ADD COLUMN "measure_unit" varchar(2);