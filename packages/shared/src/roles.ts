/**
 * PRD §6 — exactly five roles. Never introduce a sixth, and never use any
 * other label ("Owner", "Ops", "Client Manager", bare "manager"/"agent")
 * anywhere in the product.
 */
export const WORKSPACE_ROLES = ["client_admin", "campaign_manager", "inbox_agent", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** Application-level role, held on the user record, never per-workspace. */
export const SUPER_ADMIN = "super_admin" as const;

export const VIEW_FULL_PHONE_NUMBERS = "view_full_phone_numbers" as const;

/**
 * PRD §6.2 — the permission matrix, condensed to the actions with named
 * requirements elsewhere in the document. `true`/`false` are unconditional;
 * a string names the footnote/condition that applies (e.g. "own import,
 * within 24h"). Super Admin can always do everything and is omitted.
 */
export const PERMISSION_MATRIX: Record<
  string,
  Record<WorkspaceRole, boolean | string>
> = {
  edit_client_profile: { client_admin: true, campaign_manager: false, inbox_agent: false, viewer: false },
  add_whatsapp_number: { client_admin: false, campaign_manager: false, inbox_agent: false, viewer: false }, // Super Admin only
  view_access_token: { client_admin: false, campaign_manager: false, inbox_agent: false, viewer: false }, // Super Admin only
  import_contacts: { client_admin: true, campaign_manager: true, inbox_agent: false, viewer: false },
  undo_import: { client_admin: true, campaign_manager: "own import, within 24h", inbox_agent: false, viewer: false },
  export_contacts: { client_admin: true, campaign_manager: true, inbox_agent: false, viewer: false },
  delete_contact: { client_admin: true, campaign_manager: false, inbox_agent: false, viewer: false },
  merge_contacts: { client_admin: true, campaign_manager: false, inbox_agent: false, viewer: false },
  archive_contact: { client_admin: true, campaign_manager: true, inbox_agent: false, viewer: false },
  manage_groups_and_tags: { client_admin: true, campaign_manager: true, inbox_agent: false, viewer: false },
  manage_saved_segments: { client_admin: true, campaign_manager: true, inbox_agent: false, viewer: false },
  change_opt_out_status: { client_admin: true, campaign_manager: "opt-out only, not re-opt-in", inbox_agent: true, viewer: false },
  create_template: { client_admin: true, campaign_manager: true, inbox_agent: false, viewer: false },
  submit_template_to_meta: { client_admin: true, campaign_manager: true, inbox_agent: false, viewer: false },
  edit_template_after_approval: { client_admin: true, campaign_manager: false, inbox_agent: false, viewer: false },
  create_campaign: { client_admin: true, campaign_manager: true, inbox_agent: false, viewer: false },
  send_test_message: { client_admin: true, campaign_manager: true, inbox_agent: false, viewer: false },
  launch_campaign: { client_admin: true, campaign_manager: true, inbox_agent: false, viewer: false },
  approve_campaign: { client_admin: true, campaign_manager: false, inbox_agent: false, viewer: false },
  pause_resume_cancel_campaign: { client_admin: true, campaign_manager: true, inbox_agent: false, viewer: false },
  view_inbox: { client_admin: true, campaign_manager: true, inbox_agent: true, viewer: true },
  reply_in_inbox: { client_admin: true, campaign_manager: true, inbox_agent: true, viewer: false },
  assign_conversation: { client_admin: true, campaign_manager: true, inbox_agent: true, viewer: false },
  block_user: { client_admin: true, campaign_manager: true, inbox_agent: true, viewer: false },
  manage_quick_replies: { client_admin: true, campaign_manager: false, inbox_agent: false, viewer: false },
  view_reports: { client_admin: true, campaign_manager: true, inbox_agent: false, viewer: true },
  export_report: { client_admin: true, campaign_manager: true, inbox_agent: false, viewer: false },
  view_usage_and_cost: { client_admin: "own workspace", campaign_manager: false, inbox_agent: false, viewer: false },
  view_full_phone_numbers: { client_admin: true, campaign_manager: true, inbox_agent: false, viewer: false }, // extra grant, see VIEW_FULL_PHONE_NUMBERS
  manage_users: { client_admin: true, campaign_manager: false, inbox_agent: false, viewer: false },
  view_audit_log: { client_admin: true, campaign_manager: false, inbox_agent: false, viewer: false },
  change_settings: { client_admin: true, campaign_manager: false, inbox_agent: false, viewer: false },
};
