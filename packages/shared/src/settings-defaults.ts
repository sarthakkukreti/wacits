/**
 * PRD §21.6 — the platform-wide default for every named setting. All of
 * these are CITS product policy, not Meta rules, and must be editable by a
 * Super Admin without a deploy (DM-30). Never hardcode one of these values
 * anywhere else in the codebase — read it through the settings resolution
 * path (workspace override, else this default).
 */
export const PLATFORM_SETTING_DEFAULTS = [
  {
    key: "typed_confirmation_threshold",
    valueType: "integer",
    value: 500,
    description:
      "Above this recipient count, launching a campaign requires typing the campaign name. CITS product policy, not a Meta rule.",
    minimum: 1,
  },
  {
    key: "campaign_approval_threshold",
    valueType: "integer",
    value: 1000,
    description:
      "At or above this recipient count, launching a campaign additionally requires approval by a Client Admin or Super Admin. Must never be set below typed_confirmation_threshold (DM-31).",
    minimum: 1,
  },
  {
    key: "frequency_governor_ceiling",
    valueType: "integer",
    value: 4,
    description:
      "CITS-side maximum marketing messages per contact per rolling period, per client. Independent of Meta's own per-user cap.",
    minimum: 1,
  },
  {
    key: "frequency_governor_period_days",
    valueType: "integer",
    value: 30,
    description: "The rolling period, in days, for frequency_governor_ceiling.",
    minimum: 1,
  },
  {
    key: "unresolved_send_age_hours",
    valueType: "duration",
    value: 6,
    description:
      "Single value used identically by the reconciliation sweep, the dashboard tile and the alert for a send with no terminal status.",
    minimum: 1,
  },
  {
    key: "reply_attribution_window_days",
    valueType: "duration",
    value: 7,
    description:
      "CITS product policy. Single value used identically by inbox attribution and by campaign 'Replied'/'Opted out' counts.",
    minimum: 1,
  },
  {
    key: "token_health_check_cadence_hours",
    valueType: "duration",
    value: 6,
    description: "How often stored access tokens are re-verified.",
    minimum: 1,
  },
  {
    key: "deliverability_suspect_n",
    valueType: "integer",
    value: 3,
    description: "Occurrences of error 131026 required before a contact becomes 'suspect' (DM-22).",
    minimum: 1,
  },
  {
    key: "deliverability_suspect_m",
    valueType: "integer",
    value: 2,
    description: "Distinct campaigns required, alongside deliverability_suspect_n (DM-22).",
    minimum: 1,
  },
  {
    key: "deliverability_suspect_d",
    valueType: "integer",
    value: 2,
    description: "Distinct calendar days required, alongside deliverability_suspect_n (DM-22).",
    minimum: 1,
  },
] as const;
