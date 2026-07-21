CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'system', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."campaign_state" AS ENUM('draft', 'pending_approval', 'queued', 'scheduled', 'running', 'paused', 'completed', 'partially_delivered', 'stopped_by_meta', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('onboarding', 'active', 'paused', 'suspended', 'archived');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('connected', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."consent_category" AS ENUM('marketing', 'utility', 'authentication', 'all');--> statement-breakpoint
CREATE TYPE "public"."consent_direction" AS ENUM('opt_in', 'opt_out');--> statement-breakpoint
CREATE TYPE "public"."consent_source_type" AS ENUM('website_form', 'sms', 'ivr', 'paper', 'import', 'inbound_reply', 'opt_out_button', 'user_preferences_webhook', 'error_131050', 'off_platform_request');--> statement-breakpoint
CREATE TYPE "public"."conversation_state" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."deliverability_state" AS ENUM('unknown', 'deliverable', 'suspect', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."error_class" AS ENUM('RETRY_BACKOFF', 'TERMINAL', 'CONDITIONAL', 'PROBABLE_INVALID_CONTACT', 'OPERATIONAL_ALERT');--> statement-breakpoint
CREATE TYPE "public"."import_job_state" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."margin_charge_type" AS ENUM('percentage', 'fixed_per_message');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('sent', 'delivered', 'read', 'played', 'failed');--> statement-breakpoint
CREATE TYPE "public"."meta_block_state" AS ENUM('blocked', 'unblocked', 'failed');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email');--> statement-breakpoint
CREATE TYPE "public"."notification_severity" AS ENUM('informational', 'paging');--> statement-breakpoint
CREATE TYPE "public"."quality_rating" AS ENUM('green', 'yellow', 'red', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."recipient_state" AS ENUM('pending', 'queued', 'accepted', 'held', 'sent', 'delivered', 'read', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."send_path" AS ENUM('cloud_api', 'marketing_messages');--> statement-breakpoint
CREATE TYPE "public"."setting_value_type" AS ENUM('integer', 'decimal', 'boolean', 'text', 'duration', 'time_of_day', 'json');--> statement-breakpoint
CREATE TYPE "public"."template_category" AS ENUM('marketing', 'utility', 'authentication');--> statement-breakpoint
CREATE TYPE "public"."template_status" AS ENUM('APPROVED', 'PENDING', 'PAUSED', 'DISABLED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."workspace_role" AS ENUM('client_admin', 'campaign_manager', 'inbox_agent', 'viewer');--> statement-breakpoint
CREATE TABLE "access_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"target_id" uuid NOT NULL,
	"encrypted_token_value" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"label" text,
	"expires_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"last_health_check_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_portfolio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meta_business_portfolio_id" text NOT NULL,
	"display_name" text NOT NULL,
	"business_verification_status" text DEFAULT 'unverified' NOT NULL,
	"messaging_limit_tier" integer DEFAULT 250 NOT NULL,
	"tier_source" text,
	"tier_observed_at" timestamp with time zone,
	"phone_number_capacity" integer DEFAULT 2 NOT NULL,
	"template_messages_sent_rolling_365d" integer DEFAULT 0 NOT NULL,
	"count_observed_at" timestamp with time zone,
	"portfolio_pacing_state" text DEFAULT 'paced' NOT NULL,
	"enforcement_state" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_portfolio_meta_business_portfolio_id_unique" UNIQUE("meta_business_portfolio_id")
);
--> statement-breakpoint
CREATE TABLE "client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"organization_id" uuid,
	"contact_person" text,
	"status" "client_status" DEFAULT 'onboarding' NOT NULL,
	"status_changed_at" timestamp with time zone,
	"status_changed_by" uuid,
	"default_language" text DEFAULT 'en' NOT NULL,
	"notes" text,
	"onboarding_checklist" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "sender_number" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meta_phone_number_id" text NOT NULL,
	"whatsapp_business_account_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"display_phone_number" text NOT NULL,
	"display_name" text NOT NULL,
	"name_status" text DEFAULT 'NONE' NOT NULL,
	"registration_status" text DEFAULT 'unregistered' NOT NULL,
	"data_localization_region" text,
	"quality_rating" "quality_rating" DEFAULT 'unknown' NOT NULL,
	"quality_observed_at" timestamp with time zone,
	"throughput_mps" integer DEFAULT 80 NOT NULL,
	"throughput_observed_at" timestamp with time zone,
	"connection_status" "connection_status" DEFAULT 'connected' NOT NULL,
	"mm_lite_onboarding_state" text DEFAULT 'not_onboarded' NOT NULL,
	"registration_attempt_count" integer DEFAULT 0 NOT NULL,
	"registration_attempt_window_start" timestamp with time zone,
	"deregistration_attempt_count" integer DEFAULT 0 NOT NULL,
	"deregistration_attempt_window_start" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sender_number_meta_phone_number_id_unique" UNIQUE("meta_phone_number_id"),
	CONSTRAINT "sender_number_meta_phone_id_unique" UNIQUE("meta_phone_number_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_business_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meta_waba_id" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"account_review_status" text,
	"business_portfolio_id" uuid NOT NULL,
	"template_quota" integer DEFAULT 250 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_business_account_meta_waba_id_unique" UNIQUE("meta_waba_id")
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"account_id" text NOT NULL,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"image" text,
	"super_admin" boolean DEFAULT false NOT NULL,
	"last_sign_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_client_permission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "user_client_permission_active_unique" UNIQUE("user_id","client_id","permission_key","revoked_at")
);
--> statement-breakpoint
CREATE TABLE "user_client_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"role" "workspace_role" NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "user_client_role_active_unique" UNIQUE("user_id","client_id","revoked_at")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_type_client_name_unique" UNIQUE("client_id","name")
);
--> statement-breakpoint
CREATE TABLE "click_tracking_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"short_domain" text NOT NULL,
	"fallback_url" text NOT NULL,
	"link_expiry_days" integer DEFAULT 90 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "click_tracking_config_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "contact_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_type_client_name_unique" UNIQUE("client_id","name")
);
--> statement-breakpoint
CREATE TABLE "conversational_component" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"sender_number_id" uuid NOT NULL,
	"component_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_synced_to_meta_at" timestamp with time zone,
	"last_sync_error" text,
	CONSTRAINT "conversational_component_unique" UNIQUE("sender_number_id","component_type")
);
--> statement-breakpoint
CREATE TABLE "internal_test_number" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"phone_number" text NOT NULL,
	"label" text,
	"added_by" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "internal_test_number_unique" UNIQUE("client_id","phone_number")
);
--> statement-breakpoint
CREATE TABLE "notification_recipient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"category" text NOT NULL,
	"user_id" uuid,
	"external_address" text,
	"channel" "notification_channel" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "notification_recipient_unique" UNIQUE("client_id","category","user_id","channel")
);
--> statement-breakpoint
CREATE TABLE "opt_out_keyword" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"keyword" text NOT NULL,
	"direction" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opt_out_keyword_unique" UNIQUE("client_id","keyword","language")
);
--> statement-breakpoint
CREATE TABLE "platform_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value_type" "setting_value_type" NOT NULL,
	"value" jsonb NOT NULL,
	"description" text NOT NULL,
	"minimum" jsonb,
	"maximum" jsonb,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quick_reply" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"title" text NOT NULL,
	"shortcut" text NOT NULL,
	"body" text NOT NULL,
	"category" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quick_reply_client_shortcut_unique" UNIQUE("client_id","shortcut")
);
--> statement-breakpoint
CREATE TABLE "quiet_hours_window" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"days_of_week" jsonb NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_setting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"set_by" uuid NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_setting_client_key_unique" UNIQUE("client_id","key")
);
--> statement-breakpoint
CREATE TABLE "consent_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"phone_number_as_recorded" text NOT NULL,
	"direction" "consent_direction" NOT NULL,
	"category" "consent_category" NOT NULL,
	"verbatim_consent_wording" text,
	"business_name_shown" text,
	"channel_disclosure_text" text,
	"source_type" "consent_source_type" NOT NULL,
	"source_reference" text,
	"ip_address" text,
	"user_agent" text,
	"recorded_by" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"phone_number" text NOT NULL,
	"raw_phone_input" text NOT NULL,
	"country_code" text,
	"first_name" text,
	"last_name" text,
	"member_id" text,
	"designation" text,
	"organization" text,
	"city" text,
	"state" text,
	"contact_type_id" uuid,
	"email" text,
	"language" text DEFAULT 'en' NOT NULL,
	"notes" text,
	"deliverability_state" "deliverability_state" DEFAULT 'unknown' NOT NULL,
	"deliverability_changed_at" timestamp with time zone,
	"deliverability_changed_by" uuid,
	"archived" text DEFAULT 'false' NOT NULL,
	"archived_at" timestamp with time zone,
	"custom_attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text,
	"marketing_consent_state" text DEFAULT 'unknown' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"last_outbound_at" timestamp with time zone,
	"lifetime_message_count" integer DEFAULT 0 NOT NULL,
	"strike_131026_count" integer DEFAULT 0 NOT NULL,
	"strike_131026_distinct_campaigns" integer DEFAULT 0 NOT NULL,
	"strike_131026_distinct_days" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_client_phone_unique" UNIQUE("client_id","phone_number")
);
--> statement-breakpoint
CREATE TABLE "contact_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"cached_member_count" integer DEFAULT 0 NOT NULL,
	"last_recount_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_group_client_name_unique" UNIQUE("client_id","name")
);
--> statement-breakpoint
CREATE TABLE "contact_group_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"added_by" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_group_member_unique" UNIQUE("group_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "contact_tag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"applied_by" uuid NOT NULL,
	CONSTRAINT "contact_tag_unique" UNIQUE("tag_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "frequency_ledger_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"campaign_id" uuid,
	"counted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_block_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"sender_number_id" uuid NOT NULL,
	"contact_phone_number" text NOT NULL,
	"state" "meta_block_state" NOT NULL,
	"blocked_at" timestamp with time zone,
	"unblocked_at" timestamp with time zone,
	"last_error_code" text,
	CONSTRAINT "meta_block_entry_unique" UNIQUE("sender_number_id","contact_phone_number")
);
--> statement-breakpoint
CREATE TABLE "saved_segment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"filter_definition" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_resolved_count" integer,
	"last_resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_segment_client_name_unique" UNIQUE("client_id","name")
);
--> statement-breakpoint
CREATE TABLE "suppression_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_number" text NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"first_suppressed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_reconfirmed_at" timestamp with time zone,
	"notes" text,
	"originating_client_id" uuid,
	CONSTRAINT "suppression_entry_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tag_client_name_unique" UNIQUE("client_id","name")
);
--> statement-breakpoint
CREATE TABLE "template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"whatsapp_business_account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"language" text NOT NULL,
	"category" "template_category" NOT NULL,
	"current_status" "template_status" DEFAULT 'PENDING' NOT NULL,
	"current_quality_score" text DEFAULT 'UNKNOWN' NOT NULL,
	"correct_category" "template_category",
	"pause_count" integer DEFAULT 0 NOT NULL,
	"paused_until" timestamp with time zone,
	"meta_template_id" text,
	"send_path" "send_path" DEFAULT 'cloud_api' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_waba_name_language_unique" UNIQUE("whatsapp_business_account_id","name","language")
);
--> statement-breakpoint
CREATE TABLE "template_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"components" jsonb NOT NULL,
	"parameter_format" text DEFAULT 'positional' NOT NULL,
	"sample_values" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"review_outcome" text,
	"rejection_reason" text,
	"rejection_recommendation" text,
	"approved_at" timestamp with time zone,
	"language" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"campaign_type_id" uuid,
	"sender_number_id" uuid NOT NULL,
	"template_version_id" uuid NOT NULL,
	"send_path" "send_path" DEFAULT 'cloud_api' NOT NULL,
	"optimisation_spec" jsonb,
	"scheduled_at" timestamp with time zone,
	"state" "campaign_state" DEFAULT 'draft' NOT NULL,
	"state_changed_at" timestamp with time zone,
	"pause_reason" text,
	"stop_reason" text,
	"approval_requested_by" uuid,
	"approval_requested_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"typed_confirmation_given_by" uuid,
	"typed_confirmation_given_at" timestamp with time zone,
	"count_queued" integer DEFAULT 0 NOT NULL,
	"count_accepted" integer DEFAULT 0 NOT NULL,
	"count_sent" integer DEFAULT 0 NOT NULL,
	"count_delivered" integer DEFAULT 0 NOT NULL,
	"count_read" integer DEFAULT 0 NOT NULL,
	"count_failed" integer DEFAULT 0 NOT NULL,
	"dropped_by_pacing_count" integer DEFAULT 0 NOT NULL,
	"blocked_by_frequency_cap_count" integer DEFAULT 0 NOT NULL,
	"cost_estimate" integer,
	"cost_actual" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_audience_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"filter_definition" jsonb,
	"group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"saved_segment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolved_contact_count" integer NOT NULL,
	"suppressed_count" integer DEFAULT 0 NOT NULL,
	"frequency_capped_count" integer DEFAULT 0 NOT NULL,
	"snapshot_taken_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_recipient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"template_version_id" uuid NOT NULL,
	"attempt_key" integer DEFAULT 1 NOT NULL,
	"resolved_parameter_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" "recipient_state" DEFAULT 'pending' NOT NULL,
	"skip_reason" text,
	"error_code" text,
	"message_id" text,
	"send_id" text NOT NULL,
	"first_queued_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	CONSTRAINT "campaign_recipient_outbox_unique" UNIQUE("campaign_id","contact_id","template_version_id","attempt_key"),
	CONSTRAINT "campaign_recipient_send_id_unique" UNIQUE("send_id")
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"sender_number_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"state" "conversation_state" DEFAULT 'open' NOT NULL,
	"state_changed_at" timestamp with time zone,
	"state_changed_by" uuid,
	"assigned_user_id" uuid,
	"last_inbound_at" timestamp with time zone,
	"last_outbound_at" timestamp with time zone,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_number_contact_unique" UNIQUE("sender_number_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "conversation_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_service_window" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"sender_number_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"opened_by" text NOT NULL,
	"meta_conversation_id" text,
	"free_entry_point_flag" text DEFAULT 'false' NOT NULL,
	CONSTRAINT "customer_service_window_unique" UNIQUE("sender_number_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"sender_number_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"direction" "message_direction" NOT NULL,
	"wamid" text,
	"send_id" text,
	"campaign_recipient_id" uuid,
	"conversation_id" uuid NOT NULL,
	"type" text NOT NULL,
	"content_or_template_ref" jsonb,
	"template_version_id" uuid,
	"media_reference" text,
	"current_status" "message_status",
	"current_status_rank" integer DEFAULT 0 NOT NULL,
	"pricing_category" text,
	"billable" text DEFAULT 'unknown' NOT NULL,
	"sent_at" timestamp with time zone,
	"failed_error_code" text,
	"failed_api_surface" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_wamid_unique" UNIQUE("wamid")
);
--> statement-breakpoint
CREATE TABLE "message_status_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"wamid" text NOT NULL,
	"status" "message_status" NOT NULL,
	"provider_timestamp" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_code" text,
	"api_surface" text,
	"raw_payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	CONSTRAINT "message_status_event_wamid_status_unique" UNIQUE("wamid","status")
);
--> statement-breakpoint
CREATE TABLE "import_created_contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"import_job_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_error" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"import_job_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw_row" jsonb NOT NULL,
	"error_type" text NOT NULL,
	"error_message" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer NOT NULL,
	"row_count" integer,
	"state" "import_job_state" DEFAULT 'pending' NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"errored_count" integer DEFAULT 0 NOT NULL,
	"mapping_definition" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"undo_available_until" timestamp with time zone,
	"undone_at" timestamp with time zone,
	"undone_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "click_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"click_link_id" uuid NOT NULL,
	"token" text NOT NULL,
	"message_id" uuid,
	"wamid" text,
	"contact_id" uuid,
	"clicked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	"coarse_ip" text
);
--> statement-breakpoint
CREATE TABLE "click_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"template_version_id" uuid NOT NULL,
	"destination_url" text NOT NULL,
	"utm_parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"short_domain" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "margin_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"label" text NOT NULL,
	"created_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "margin_config_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"margin_config_id" uuid NOT NULL,
	"pricing_category" text NOT NULL,
	"charge_type" "margin_charge_type" NOT NULL,
	"value" integer NOT NULL,
	"minimum_charge_paise" integer,
	"maximum_charge_paise" integer,
	CONSTRAINT "margin_config_entry_unique" UNIQUE("margin_config_id","pricing_category")
);
--> statement-breakpoint
CREATE TABLE "rate_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region" text NOT NULL,
	"currency" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"source" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_card_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rate_card_id" uuid NOT NULL,
	"category" text NOT NULL,
	"in_window_flag" text DEFAULT 'false' NOT NULL,
	"tier_lower_bound" integer DEFAULT 0 NOT NULL,
	"tier_upper_bound" integer,
	"unit_price_paise" integer NOT NULL,
	CONSTRAINT "rate_card_entry_unique" UNIQUE("rate_card_id","category","in_window_flag","tier_lower_bound")
);
--> statement-breakpoint
CREATE TABLE "usage_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"sender_number_id" uuid NOT NULL,
	"pricing_category" text NOT NULL,
	"billable" text NOT NULL,
	"rate_card_entry_id" uuid,
	"unit_cost_paise" integer DEFAULT 0 NOT NULL,
	"margin_config_entry_id" uuid,
	"margin_amount_paise" integer DEFAULT 0 NOT NULL,
	"gst_amount_paise" integer DEFAULT 0 NOT NULL,
	"total_paise" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'webhook_pricing' NOT NULL,
	CONSTRAINT "usage_record_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"actor_user_id" uuid,
	"actor_type" "audit_actor_type" DEFAULT 'user' NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before_after_summary" jsonb,
	"ip_address" text,
	"user_agent" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_code_classification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_surface" text NOT NULL,
	"code" text NOT NULL,
	"subcode" text,
	"title" text NOT NULL,
	"error_class" "error_class" NOT NULL,
	"retry_policy" jsonb,
	"user_facing_explanation" text,
	"counts_toward_131026_evidence" text DEFAULT 'false' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "error_code_classification_unique" UNIQUE("api_surface","code","subcode")
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"recipient_user_id" uuid NOT NULL,
	"severity" "notification_severity" NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"related_entity" text,
	"delivered_channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signature_verified" text NOT NULL,
	"object_type" text,
	"waba_id" text,
	"field" text,
	"raw_body" text NOT NULL,
	"body_hash" text NOT NULL,
	"processing_state" text DEFAULT 'pending' NOT NULL,
	"processing_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "sender_number" ADD CONSTRAINT "sender_number_whatsapp_business_account_id_whatsapp_business_account_id_fk" FOREIGN KEY ("whatsapp_business_account_id") REFERENCES "public"."whatsapp_business_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_number" ADD CONSTRAINT "sender_number_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_business_account" ADD CONSTRAINT "whatsapp_business_account_business_portfolio_id_business_portfolio_id_fk" FOREIGN KEY ("business_portfolio_id") REFERENCES "public"."business_portfolio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_client_permission" ADD CONSTRAINT "user_client_permission_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_client_permission" ADD CONSTRAINT "user_client_permission_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_client_permission" ADD CONSTRAINT "user_client_permission_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_client_role" ADD CONSTRAINT "user_client_role_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_client_role" ADD CONSTRAINT "user_client_role_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_client_role" ADD CONSTRAINT "user_client_role_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_type" ADD CONSTRAINT "campaign_type_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_tracking_config" ADD CONSTRAINT "click_tracking_config_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_type" ADD CONSTRAINT "contact_type_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversational_component" ADD CONSTRAINT "conversational_component_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversational_component" ADD CONSTRAINT "conversational_component_sender_number_id_sender_number_id_fk" FOREIGN KEY ("sender_number_id") REFERENCES "public"."sender_number"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_test_number" ADD CONSTRAINT "internal_test_number_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_test_number" ADD CONSTRAINT "internal_test_number_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipient" ADD CONSTRAINT "notification_recipient_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipient" ADD CONSTRAINT "notification_recipient_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opt_out_keyword" ADD CONSTRAINT "opt_out_keyword_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_setting" ADD CONSTRAINT "platform_setting_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_reply" ADD CONSTRAINT "quick_reply_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiet_hours_window" ADD CONSTRAINT "quiet_hours_window_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_setting" ADD CONSTRAINT "workspace_setting_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_setting" ADD CONSTRAINT "workspace_setting_key_platform_setting_key_fk" FOREIGN KEY ("key") REFERENCES "public"."platform_setting"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_setting" ADD CONSTRAINT "workspace_setting_set_by_user_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_contact_type_id_contact_type_id_fk" FOREIGN KEY ("contact_type_id") REFERENCES "public"."contact_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_deliverability_changed_by_user_id_fk" FOREIGN KEY ("deliverability_changed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_group" ADD CONSTRAINT "contact_group_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_group_member" ADD CONSTRAINT "contact_group_member_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_group_member" ADD CONSTRAINT "contact_group_member_group_id_contact_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."contact_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_group_member" ADD CONSTRAINT "contact_group_member_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_group_member" ADD CONSTRAINT "contact_group_member_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tag" ADD CONSTRAINT "contact_tag_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tag" ADD CONSTRAINT "contact_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tag" ADD CONSTRAINT "contact_tag_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tag" ADD CONSTRAINT "contact_tag_applied_by_user_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frequency_ledger_entry" ADD CONSTRAINT "frequency_ledger_entry_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frequency_ledger_entry" ADD CONSTRAINT "frequency_ledger_entry_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_block_entry" ADD CONSTRAINT "meta_block_entry_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_block_entry" ADD CONSTRAINT "meta_block_entry_sender_number_id_sender_number_id_fk" FOREIGN KEY ("sender_number_id") REFERENCES "public"."sender_number"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_segment" ADD CONSTRAINT "saved_segment_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_segment" ADD CONSTRAINT "saved_segment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppression_entry" ADD CONSTRAINT "suppression_entry_originating_client_id_client_id_fk" FOREIGN KEY ("originating_client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_whatsapp_business_account_id_whatsapp_business_account_id_fk" FOREIGN KEY ("whatsapp_business_account_id") REFERENCES "public"."whatsapp_business_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_version" ADD CONSTRAINT "template_version_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_version" ADD CONSTRAINT "template_version_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_campaign_type_id_campaign_type_id_fk" FOREIGN KEY ("campaign_type_id") REFERENCES "public"."campaign_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_sender_number_id_sender_number_id_fk" FOREIGN KEY ("sender_number_id") REFERENCES "public"."sender_number"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_template_version_id_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."template_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_approval_requested_by_user_id_fk" FOREIGN KEY ("approval_requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_typed_confirmation_given_by_user_id_fk" FOREIGN KEY ("typed_confirmation_given_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_audience_snapshot" ADD CONSTRAINT "campaign_audience_snapshot_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_audience_snapshot" ADD CONSTRAINT "campaign_audience_snapshot_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_template_version_id_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."template_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_sender_number_id_sender_number_id_fk" FOREIGN KEY ("sender_number_id") REFERENCES "public"."sender_number"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_state_changed_by_user_id_fk" FOREIGN KEY ("state_changed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_note" ADD CONSTRAINT "conversation_note_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_note" ADD CONSTRAINT "conversation_note_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_note" ADD CONSTRAINT "conversation_note_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_window" ADD CONSTRAINT "customer_service_window_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_window" ADD CONSTRAINT "customer_service_window_sender_number_id_sender_number_id_fk" FOREIGN KEY ("sender_number_id") REFERENCES "public"."sender_number"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_window" ADD CONSTRAINT "customer_service_window_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_sender_number_id_sender_number_id_fk" FOREIGN KEY ("sender_number_id") REFERENCES "public"."sender_number"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_campaign_recipient_id_campaign_recipient_id_fk" FOREIGN KEY ("campaign_recipient_id") REFERENCES "public"."campaign_recipient"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_template_version_id_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."template_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_status_event" ADD CONSTRAINT "message_status_event_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_status_event" ADD CONSTRAINT "message_status_event_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_created_contact" ADD CONSTRAINT "import_created_contact_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_created_contact" ADD CONSTRAINT "import_created_contact_import_job_id_import_job_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_created_contact" ADD CONSTRAINT "import_created_contact_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_error" ADD CONSTRAINT "import_error_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_error" ADD CONSTRAINT "import_error_import_job_id_import_job_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_undone_by_user_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_event" ADD CONSTRAINT "click_event_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_event" ADD CONSTRAINT "click_event_click_link_id_click_link_id_fk" FOREIGN KEY ("click_link_id") REFERENCES "public"."click_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_event" ADD CONSTRAINT "click_event_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_event" ADD CONSTRAINT "click_event_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_link" ADD CONSTRAINT "click_link_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_link" ADD CONSTRAINT "click_link_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_link" ADD CONSTRAINT "click_link_template_version_id_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."template_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "margin_config" ADD CONSTRAINT "margin_config_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "margin_config_entry" ADD CONSTRAINT "margin_config_entry_margin_config_id_margin_config_id_fk" FOREIGN KEY ("margin_config_id") REFERENCES "public"."margin_config"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card_entry" ADD CONSTRAINT "rate_card_entry_rate_card_id_rate_card_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."rate_card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_record" ADD CONSTRAINT "usage_record_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_record" ADD CONSTRAINT "usage_record_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_record" ADD CONSTRAINT "usage_record_sender_number_id_sender_number_id_fk" FOREIGN KEY ("sender_number_id") REFERENCES "public"."sender_number"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_record" ADD CONSTRAINT "usage_record_rate_card_entry_id_rate_card_entry_id_fk" FOREIGN KEY ("rate_card_entry_id") REFERENCES "public"."rate_card_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_record" ADD CONSTRAINT "usage_record_margin_config_entry_id_margin_config_entry_id_fk" FOREIGN KEY ("margin_config_entry_id") REFERENCES "public"."margin_config_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_event" ADD CONSTRAINT "webhook_event_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;