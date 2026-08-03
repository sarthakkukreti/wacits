-- Required for contact_name_trgm_idx below (fuzzy name search, PRD §21.3).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "correlation_id" text;--> statement-breakpoint
CREATE INDEX "contact_client_contact_type_idx" ON "contact" USING btree ("client_id","contact_type_id");--> statement-breakpoint
CREATE INDEX "contact_client_city_idx" ON "contact" USING btree ("client_id","city");--> statement-breakpoint
CREATE INDEX "contact_custom_attributes_gin_idx" ON "contact" USING gin ("custom_attributes");--> statement-breakpoint
CREATE INDEX "contact_name_trgm_idx" ON "contact" USING gin ((coalesce("first_name", '') || ' ' || coalesce("last_name", '')) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "campaign_pending_approval_idx" ON "campaign" USING btree ("approval_requested_at") WHERE "campaign"."state" = 'pending_approval';--> statement-breakpoint
CREATE INDEX "campaign_recipient_campaign_state_idx" ON "campaign_recipient" USING btree ("campaign_id","state");--> statement-breakpoint
CREATE INDEX "conversation_open_by_activity_idx" ON "conversation" USING btree ("client_id",greatest(coalesce("last_inbound_at", 'epoch'), coalesce("last_outbound_at", 'epoch')) desc) WHERE "conversation"."state" = 'open';--> statement-breakpoint
CREATE INDEX "message_conversation_created_idx" ON "message" USING btree ("client_id","conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "message_status_event_message_provider_ts_idx" ON "message_status_event" USING btree ("message_id","provider_timestamp");--> statement-breakpoint
CREATE INDEX "webhook_event_unprocessed_idx" ON "webhook_event" USING btree ("received_at") WHERE "webhook_event"."processing_state" != 'processed';