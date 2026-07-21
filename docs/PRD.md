# CITS WhatsApp Communication Manager
## Product Requirements Document

**Prepared for:** Cyberlative IT Solutions (CITS)
**Version:** 1.0
**Compiled:** 21 July 2026

---

### About this document

This is the complete specification for an internal, multi-client WhatsApp campaign and inbox
platform built directly on Meta's WhatsApp Cloud API. It is written to be implemented from
directly — by a solo developer, with or without an AI coding tool — and to be read by
non-technical stakeholders at the client organisations CITS serves.

It contains **626 numbered requirements**, each written as a testable statement. Requirement
identifiers (`CP-12`, `SE-30`, and so on) are stable and are cross-referenced throughout.

**Every platform fact in this document was verified against Meta's own live documentation on
21 July 2026.** Meta changed its pricing model, its messaging-limit architecture and its quality
enforcement significantly during 2025 and 2026, and much of the guidance circulating publicly is
now obsolete. Where a figure could not be confirmed from a primary Meta source, it is marked
**[Verify before build]** rather than stated as fact.

### Three things to do before writing any code

1. **Download Meta's INR rate card** from Business Manager. Every rupee figure in this document is
   a secondary transcription and must not be quoted to a client until confirmed.
2. **Re-check Meta's WhatsApp changelog.** It returned server errors throughout the research for
   this document, so a very recent breaking change may not be captured here.
3. **Run the three technical spikes in §3** — the BullMQ-on-Bun adapter, BullMQ's Valkey version
   requirements, and a 72-hour Bun soak test — before freezing the architecture.

### Key decisions already made

| Decision | Choice |
|---|---|
| WhatsApp account ownership | CITS owns the business portfolio, the WABAs and one number per client |
| Meta partner programme | None needed for v1 — no App Review, no Embedded Signup, no Tech Provider |
| Commercial model | Internal use only; usage and cost tracked per client, nobody billed |
| Year-one scale | Under 10 clients, under 50,000 messages per month |
| Channels | WhatsApp only |

§2 records these as a decision log with the risks CITS has explicitly accepted, including the fact
that the research recommended against the ownership model chosen and why it was overridden.

---

## Contents

- [1. Product overview](#1-product-overview)
- [2. Platform constraints and decisions](#2-platform-constraints-and-decisions)
- [3. Technology stack](#3-technology-stack)
- [4. Architecture](#4-architecture)
- [5. Multi-client management](#5-multi-client-management)
- [6. Users, roles and permissions](#6-users-roles-and-permissions)
- [7. WhatsApp sender numbers](#7-whatsapp-sender-numbers)
- [8. Contacts, groups and tags](#8-contacts-groups-and-tags)
- [9. Contact import](#9-contact-import)
- [10. Consent and opt-out](#10-consent-and-opt-out)
- [11. Templates](#11-templates)
- [12. Campaigns](#12-campaigns)
- [13. Sending engine](#13-sending-engine)
- [14. Inbox](#14-inbox)
- [15. Reporting and dashboards](#15-reporting-and-dashboards)
- [16. Click tracking](#16-click-tracking)
- [17. Usage and cost tracking](#17-usage-and-cost-tracking)
- [18. Audit logs and notifications](#18-audit-logs-and-notifications)
- [19. Security](#19-security)
- [20. Compliance](#20-compliance)
- [21. Data model](#21-data-model)
- [22. Screens](#22-screens)
- [23. MVP scope](#23-mvp-scope)
- [24. Roadmap](#24-roadmap)
- [25. Development phases](#25-development-phases)
- [Appendix A — WhatsApp error codes and how to handle them](#appendix-a-whatsapp-error-codes-and-how-to-handle-them)
- [Appendix B — Meta onboarding checklist](#appendix-b-meta-onboarding-checklist)
- [Appendix C — Verify before build](#appendix-c-verify-before-build)
- [Appendix D — Glossary](#appendix-d-glossary)

---

## 1. Product overview

### 1.1 What this product is

The CITS WhatsApp Communication Manager is an internal web application that lets Cyberlative IT Solutions send WhatsApp messages on behalf of the organisations it serves — scientific societies, journals, conferences, universities, agricultural associations and professional bodies — and manage the replies that come back. Each client organisation gets its own dedicated WhatsApp sender number showing its own display name, its own contact lists, its own message templates and its own campaign history, all inside one system that CITS staff operate. Day to day it does four things: hold clean contact lists, get message templates approved by Meta, send campaigns to those contacts at a controlled pace, and give staff a shared inbox to answer whoever replies. It talks directly to Meta's official WhatsApp Cloud API — the same pipe every commercial tool in this market uses — with no reseller sitting in between.

### 1.2 The problem it solves

CITS currently runs client messaging through third-party products: AiSensy, WATI, Interakt, Gallabox and Gupshup. Every one of these is a software layer over the same Meta Cloud API; none of them owns the transport, so none of them can make a message cheaper, faster or more deliverable than Meta allows. What they differ on is the software and the billing wrapper.

That billing wrapper is the immediate problem. Several vendors present a marked-up per-message rate as if it were Meta's own charge. AiSensy publishes ₹1.09 for a marketing message described as "Meta's charges", against Meta's actual India marketing rate of approximately ₹0.8631 — roughly 26% above cost, not disclosed as a markup. Interakt publishes ₹0.949–0.970 for the same message (a ~10–15% spread) while selling its Enterprise tier on the explicit promise of "no markup charges", which is a plain admission that the lower tiers carry one. WATI's markup is reported around 20% from secondary sources. **[Verify before build]** — all India rupee figures in the fact base are secondary transcriptions; the INR rate card CSV must be downloaded from Business Manager before any number goes into a quote or contract.

Beyond price there are structural irritants: per-seat pricing with hard user caps (WATI Growth allows three users with no additions; Gallabox Basic caps at three), chatbot and AI features gated as paid add-ons, slow or email-only support cited as the leading complaint against the two largest vendors, and — for WATI — an inability to auto-recharge in INR because of RBI rules, which can strand a campaign mid-send.

**Being fair about what CITS gives up.** These products are mature. They ship a shared team inbox with agent routing, drag-and-drop chatbot builders, Google Sheets and Shopify connectors, CRM integrations, mobile apps, Click-to-WhatsApp ad integration and multi-channel support (Instagram, SMS, RCS) as standard at ₹2,500–3,000 per month **[Verify before build]**. They also absorb Meta's platform churn — rate card changes, API version deprecations, policy shifts — so CITS never has to. Leaving them means CITS inherits all of that maintenance, ships a narrower feature set in v1, and carries the operational risk itself. That trade is only worth making for the reasons set out at the end of this section.

### 1.3 Goals

**OV-1** The system must send WhatsApp template messages and free-form replies through Meta's Cloud API on behalf of multiple client organisations, keeping each client's contacts, templates, campaigns and conversations logically separated so that no user of one client workspace can read or send to another client's data.

**OV-2** The system must show, for every campaign, the true Meta cost basis and any CITS margin as separate figures — never a blended rate presented as Meta's charge. Rates must be stored as configuration versioned by effective date, never hardcoded, because Meta revises rate cards quarterly (1 Jan / 1 Apr / 1 Jul / 1 Oct).

**OV-3** The system must classify every template by WhatsApp category (Marketing, Utility, Authentication) at authoring time and show the author the projected cost difference before submission, because a wrongly-worded Utility template becomes a Marketing template at roughly 7.5× the price.

**OV-4** The system must never send a business-initiated message to a contact without a recorded, timestamped consent record, and must honour opt-outs received on any channel (see §10 Consent and opt-out).

**OV-5** The system must treat every campaign as interruptible: sends must be pausable mid-flight, resumable, and must correctly report partial delivery — the `partially_delivered` state — when Meta's pacing mechanisms hold or drop the remainder of a batch (see §13 Sending engine).

**OV-6** The system must track message volume and attributed cost per client, per campaign and per month, so that a commercial billing model can be switched on later without re-instrumenting the product.

**OV-7** The system must give CITS staff and client-side staff a single shared inbox per client number, with visibility of whether the 24-hour customer service window is open for each conversation, since that determines what may legally be sent.

**OV-8** The system must record an audit trail of who sent what to whom, from which number, under which template and consent record, retained for at least the period required for a compliance response (see §18 Audit logs and §20 Compliance).

**OV-9** The system must apply two independent, separately named launch guards that are CITS product policy rather than Meta rules: the **typed-confirmation threshold** (default 500 recipients; above it, launch requires typing the campaign name) and the **campaign approval threshold** (default 1,000 recipients; at or above it, the campaign enters `pending_approval` on submit and can only proceed once approved by a Client Admin or Super Admin). Both are per-workspace settings with platform-wide defaults, and the approval threshold must never be configurable below the typed-confirmation threshold (see §12 Campaign approval workflow).

**OV-10** The system must enforce a CITS-side frequency governor — a configurable per-contact ceiling on marketing messages per rolling period, set per client and platform-wide (suggested default 4 per 30 days per client) — independently of Meta's own per-user cap, applied in the pre-send suppression check and surfaced in the pre-flight summary as its own exclusion reason. This is CITS product policy, not a Meta rule.

### 1.4 Explicit non-goals for v1

- **No client billing, invoicing or payment collection.** Usage is measured; nobody is charged through the system.
- **No channels other than WhatsApp.** No Instagram DM, SMS, RCS or email.
- **No AI agents, knowledge bases or automated conversational routing.** Buy or defer.
- **No drag-and-drop chatbot builder.**
- **No Meta App Review, no Embedded Signup, no Tech Provider or Solution Partner onboarding.** Because CITS operates its own numbers inside its own already-verified business portfolio, a business system user token is sufficient. This removes an entire phase of Meta gating — app icon, hosted privacy policy, two screen recordings, Advanced Access approval, and an unpublished review turnaround — from the critical path. This is the single largest scope saving in the project.
- **No self-service client signup.** Clients are onboarded by CITS staff.
- **No commerce features** — no catalog, no WhatsApp Pay, no order-status webhooks.
- **No Official Business Account (green tick) applications.** Not required to send.
- **No native mobile app.** The web application must meet the mobile tiers set out in §1.7 instead.
- **No CITS-hosted public opt-in form.** `website_form` remains a valid consent `source_type` — it means consent was collected on the *client's own* website and imported alongside the contact — but CITS hosts no public form in v1 (see §24 Roadmap).
- **No per-agent conversation or response-time metrics.** Inbox Agents get no report access in v1.
- **No general import rollback.** Only a narrow 24-hour "undo import" exists (see §9 Contact import).
- **No max-price marketing bidding in v1**, but the send layer must keep the send path pluggable, because bidding requires Meta's separate Marketing Messages API endpoint and becomes required in eligible geographies in Q2 2027 (see §24 Roadmap).

### 1.5 Who uses it

There are exactly five roles. **Super Admin** (`super_admin`) is held on the user record and is application-level. **Client Admin** (`client_admin`), **Campaign Manager** (`campaign_manager`), **Inbox Agent** (`inbox_agent`) and **Viewer** (`viewer`) are held per workspace. There is no cross-workspace operator role: a CITS campaign operator is simply a user holding **Campaign Manager** in several workspaces.

**Super Admin.** One or two people. Needs to create client organisations, attach sender numbers, invite users, see every client's usage and cost, and see platform-wide health — quality ratings, the shared messaging limit, payment-method alerts. May approve campaigns sitting in `pending_approval`. Must never be able to silently read or export a client's message content without that access appearing in the audit log.

**Campaign Manager.** Builds contact imports, drafts and submits templates, schedules and runs campaigns. A CITS staff member typically holds this role in several workspaces at once and needs fast switching between them, with clear pre-send checks in each. Must never be able to send in a workspace they do not hold a role in, change another user's permissions, approve their own campaign, or send a campaign that has not passed consent and template validation.

**Client Admin.** A society secretary or journal manager. Needs to see their own contacts, approve campaigns that have entered `pending_approval`, request campaigns, read their own reports and manage their own staff's access within the workspace. Must never see any other client's data, must never see CITS's internal cost or margin figures, and must never be able to change the sender number configuration or platform settings.

**Inbox Agent.** Answers replies for one or more clients. Needs conversation history, the customer service window state, and quick replies. Conversations are `open` or `closed` — there is no snooze. Must never be able to launch a bulk campaign, edit templates, export a full contact list, delete conversation history, or open reports.

**Viewer.** Read-only — a committee member or editor who wants to see how a campaign performed. Needs dashboards and campaign results. Must never send anything and never export personal data. Phone numbers render masked to the last 4 digits across contact lists, campaign reports, click reports and the inbox, unless the distinct **"View full phone numbers"** permission has been granted.

### 1.6 The client organisations served, and what each message really costs

Meta's rule is strict: a template is Utility only if it is **both** non-promotional in intent **and** either specific to / requested by the recipient, or essential to them. Mixed content is Marketing. Content whose intent cannot be determined is Marketing. Since 2025-04-09, a template submitted as Utility that Meta judges to be Marketing is **approved as Marketing**, not rejected — so the cost lands on CITS's client without a rejection to warn anyone. Utility-to-Marketing recategorisation also runs continuously, with as little as 24 hours' notice, and no notice at all for businesses previously warned.

The blunt conclusion, and the most useful cost insight in this document: **most society announcements are Marketing, not Utility.** Anything that invites participation — submit, attend, register, renew, join — carries persuasive intent even when it feels administrative to the sender.

| Use case | Likely category | Indicative cost per delivered message | Reasoning |
|---|---|---|---|
| Conference website launch | Marketing | ~₹0.8631 | Broadcast announcement, promotional intent, not specific to the recipient |
| Abstract submission reminder (general call) | Marketing | ~₹0.8631 | Soliciting participation from a list; not requested by the individual |
| Abstract submission reminder (to someone with a started, incomplete submission) | Utility *candidate* | ~₹0.115, free inside an open service window until 2026-10-01 | Specific to that person's own in-progress action — but any added persuasion tips it to Marketing |
| Final-deadline reminder | Marketing | ~₹0.8631 | Urgency framing to a broad list reads as promotional |
| Journal article submission notice — "we have received your manuscript" | Utility | ~₹0.115 | Transactional confirmation of the recipient's own action |
| Journal call for papers | Marketing | ~₹0.8631 | Same words as above only in the sender's mind; this one solicits |
| Membership renewal with payment link | Marketing in practice | ~₹0.8631 | A bare dues notice to an existing member is arguably essential and specific, but adding benefits, offers or persuasion makes it mixed — and mixed is Marketing. Author two variants and test |
| Society election / voting reminder | Utility *candidate* | ~₹0.115 | Essential to an eligible member and specific to them, if written as a plain factual notice with no advocacy |
| Annual general meeting notice | Utility *candidate* | ~₹0.115 | Statutory notice to members; essential, non-promotional if kept factual |
| Committee meeting notice | Utility | ~₹0.115 | Addressed to a named committee member about their own obligation |
| Payment reminder (unpaid invoice or dues already owed) | Utility | ~₹0.115 | Specific to the recipient's own outstanding transaction |
| Product update (CITS software or service notice to a client) | Marketing unless narrowly essential | ~₹0.8631 | "Here's what's new" is promotional; "your service will be unavailable Sunday" is Utility |
| Lead follow-up | Marketing | ~₹0.8631 | Always. No Utility reading exists |
| Client support reply (inside 24h of the person's own message) | Service, free-form | Free today | Becomes chargeable from 2026-10-01 at utility-equivalent rates |

**[Verify before build]** — every rupee figure above is a medium-confidence secondary transcription of Meta's INR rate card; confirm from the CSV in Business Manager before quoting. **[Verify before build]** — the exact rates for paid service messages and for in-window Utility messages from 2026-10-01 will be published by Meta by 2026-09-01; every cost model needs both a pre- and post-October case.

Two further cost facts shape everything: Marketing messages have **no volume discount** at any scale, and Utility templates delivered while the recipient's 24-hour service window is open are **free until 2026-10-01** — so any design that first prompts a reply, then sends Utility, saves real money this year.

### 1.7 The nine client use cases, end to end

The table above prices the traffic. This subsection walks the nine client-facing use cases as actual workflows: what triggers the send, who is in the audience, which template is used and its likely Meta category, the realistic cadence, and what a good outcome looks like.

**This subsection is the specification for the starter template library in §11.** The nine use cases below and the fourteen priced rows above are one artefact, not two: §11 must ship a starter template for each use case named here, in the category stated here, and no starter template may exist in §11 that is not traceable to a row here. If a use case is added or repriced, both places change together.

**1. Conference website launch.** *Trigger:* the client confirms the conference site and call for participation are live. *Audience:* the full opted-in delegate list for that society, resolved from a saved segment, minus opt-outs and minus anyone over the CITS frequency governor's ceiling. *Template and category:* one Marketing template with the conference name, dates and a link. *Cadence:* once per conference, typically 9–12 months before the event. *Good outcome:* the campaign completes with a non-delivery rate under a few percent, click-through is measurable, and no quality-rating drop follows on the shared portfolio.

**2. Abstract submission reminder — general call.** *Trigger:* the abstract window opens, then again at the midpoint. *Audience:* the delegate list, optionally narrowed by discipline. *Template and category:* Marketing — it solicits participation from a list, and no Utility reading survives. *Cadence:* two sends, four to six weeks apart. *Good outcome:* submissions rise measurably after each send, and opt-out rate stays flat; a rising opt-out rate is the signal to cut the cadence, not to raise it.

**3. Abstract submission reminder — incomplete submission.** *Trigger:* the client supplies a list of people who started but did not finish a submission. *Audience:* only those individuals — a genuinely personal list, not a broadcast. *Template and category:* Utility *candidate*, because it is specific to that person's own in-progress action; any added persuasion tips it to Marketing and roughly 7.5×es the cost. *Cadence:* once, a few days before the deadline. *Good outcome:* a high completion rate at Utility pricing, and — where a reply has opened the customer service window — free delivery until 2026-10-01.

**4. Final-deadline reminder.** *Trigger:* 48–72 hours before the abstract or registration deadline. *Audience:* the delegate list minus anyone who has already submitted or registered, if the client can supply that exclusion list. *Template and category:* Marketing — urgency framing to a broad list reads as promotional regardless of intent. *Cadence:* once. This is a high-recipient-count send and will usually sit above the typed-confirmation threshold, and often at or above the campaign approval threshold, so it needs a Client Admin or Super Admin approval before it can move out of `pending_approval`. *Good outcome:* a visible submission spike, and portfolio headroom checked in advance so the send is not blocked at launch.

**5. Journal manuscript acknowledgement.** *Trigger:* the journal receives a manuscript. *Audience:* the single corresponding author. *Template and category:* Utility — a transactional confirmation of the recipient's own action. *Cadence:* one message per submission, continuous low-volume traffic rather than a campaign. *Good outcome:* near-total delivery, no opt-outs, and a measurable drop in "did you get my paper?" emails to the editorial office.

**6. Journal call for papers.** *Trigger:* a special issue or a themed call opens. *Audience:* the journal's author and reviewer list, usually filtered by subject area through a saved segment. *Template and category:* Marketing — it solicits, which is the whole difference from use case 5. *Cadence:* once per call, at most one call per month per list. *Good outcome:* submissions attributable to the send within the 7-day reply attribution window, with opt-out rate flat.

**7. Membership renewal and dues payment reminder.** *Trigger:* the renewal window opens, then at fixed intervals for members still unpaid. *Audience:* members whose dues are outstanding. *Template and category:* two templates, and the split matters. A bare factual dues notice referring to the member's own outstanding amount is Utility. The moment benefits, offers or persuasion are added it becomes mixed, and mixed is Marketing — author both variants and test which one Meta approves in which category. *Cadence:* an opening notice plus two or three reminders across the renewal season, well inside the frequency governor's ceiling. *Good outcome:* renewal rate up, and the Utility variant surviving Meta's continuous recategorisation rather than being silently re-approved as Marketing.

**8. Society election and voting reminder.** *Trigger:* the ballot opens, and again shortly before it closes. *Audience:* eligible members only — an explicit contact group, not a filter, because eligibility is a matter of record rather than of query. *Template and category:* Utility *candidate*, provided it is written as a plain factual notice with no advocacy for any candidate or outcome. Any advocacy makes it Marketing. *Cadence:* two sends per election. *Good outcome:* turnout up, and the template holding its Utility category across the whole voting period.

**9. Statutory meeting notices — AGM and committee.** *Trigger:* the constitutional notice period for an annual general meeting, or the scheduling of a committee meeting. *Audience:* all members for the AGM; the named committee for a committee meeting. *Template and category:* Utility *candidate* for the AGM — a statutory notice, essential and non-promotional if kept strictly factual; Utility for a committee notice, since it addresses a named member about their own obligation. *Cadence:* once per meeting, with at most one reminder. *Good outcome:* the notice is delivered and evidenced inside the statutory window, with the delivery record available from the audit log if the society is later asked to prove notice was given.

Three further use cases in the pricing table — product updates, lead follow-up and support replies — are CITS's own traffic to its clients, not client traffic to members. They are priced above and templated in §11 on the same basis, but they are not part of the nine client use cases.

### 1.8 Product quality expectations

| Expectation | Measurable form |
|---|---|
| Professional | The application must present each client's own display name and branding in the sending context, and must never show one client's name inside another client's workspace |
| Fast | Interactive pages must render usable content within 2 seconds on a 4G connection for lists up to 10,000 contacts (CITS policy target) |
| Import performance | A contact import file is hard-capped at **20,000 rows**; an import of **10,000 rows must complete within 5 minutes**; the acceptance test must exercise a file at the 20,000-row cap, not a smaller sample (CITS policy targets, see §9 Contact import) |
| Secure | All access must be authenticated and role-checked server-side; Meta tokens must be encrypted at rest and never sent to the browser; access to personal data must be logged, with logs retained at least one year (see §18 Audit logs and §20 Compliance) |
| Easy to use | A trained operator must be able to launch a campaign from an existing template and saved segment in under 5 minutes. The pre-flight summary is the only confirmation step below the typed-confirmation threshold, and it is not skippable. The additional steps required above the typed-confirmation and campaign approval thresholds — typing the campaign name, blocker re-evaluation, the required test send, the RP-11 step-up (typed campaign name) and Client Admin or Super Admin approval — are likewise not skippable |
| Mobile responsive | Every screen must be assigned exactly one of the three mobile tiers and must meet it: **mobile-critical** (fully operable at 375px width) — the inbox and campaign dashboards at minimum; **mobile-usable** (readable and navigable at 375px, editing deferred to a larger screen); **desktop-first** (degrades to a legible read-only view plus a "best used on a larger screen" notice, never a broken layout) |
| Multi-client ready | Adding a new client organisation with its own number must require no code change and no redeploy |
| Reliable for bulk messaging | Every send must be idempotent — the system must never deliver the same campaign message twice to the same recipient — and must survive a worker restart mid-campaign with no lost or duplicated sends. Every outcome must be reconciled against Meta's status webhooks, not assumed from the send response |

### 1.9 Why build instead of buy

Honestly assessed at under ten clients and under 50,000 messages a month, the cost arithmetic alone does not justify building. A ₹3,000/month subscription plus a 15% message markup on 50,000 marketing messages **[Verify before build]** — both the subscription figure and the markup percentage are secondary transcriptions, and the rupee message rate they are applied to must come from the INR rate card CSV in Business Manager — is real money, but it is not more than the opportunity cost of a solo developer's time in year one. Anyone claiming this project pays for itself on message margin at this scale is doing the sums wrong.

The case for building rests on three things the market does not sell. First, **genuine multi-client operations**: what vendors call "agency mode" is white-label branding plus a commission portal, not consolidated cross-client campaign management with per-workspace roles, per-client cost attribution and a single operator console. The closest off-the-shelf shape is respond.io's multiple workspaces at $349/month — priced as an enterprise feature and still not built for this. Second, **transparent at-cost pricing** as a durable market position, which is only credible if CITS actually holds the Meta relationship. Third, **not being priced per seat**, which is the single most complained-about dimension in this market and directly constrains how many society staff can use the tool.

The verdict: build, with eyes open. The v1 scope is deliberately narrow because the economics do not fund a broad one, and the decision to operate inside CITS's own already-verified portfolio removes the largest schedule risk — Meta App Review — from the path entirely. The cost of that decision is stated plainly and repeatedly in this document: since 2025-10-07 messaging limits and quality are pooled at the **business portfolio** level, so all clients share one daily unique-recipient cap and one blast radius, and because a WABA can never be migrated to another portfolio, a client's number can never be handed over to them. Portfolio pacing applies below 500,000 template messages in a rolling 365 days; at CITS's year-one ceiling of just under 50,000 a month the portfolio sits inside that regime for roughly the first ten months and exits only if that volume is sustained, so portfolio pacing is the **default** state in year one and the rolling-365-day count must be read as live data rather than assumed. The client has accepted these risks (see §2 Platform constraints and decisions and §7 WhatsApp sender numbers).

---

## 2. Platform constraints and decisions

### 2.1 How WhatsApp business messaging actually works

WhatsApp is not email and not SMS. You cannot send whatever you like whenever you like. Everything the product does is shaped by one mechanism: the **customer service window (CSW)**.

A 24-hour window opens when a WhatsApp user **messages or calls** the business number. Every new inbound message resets it to a fresh 24 hours. While the window is open, the business may send **any** message type — free text, images, documents, buttons — with no template and no approval. When the window is closed, **an approved message template is the only thing that can be sent.** A free-form send outside the window fails on `/messages` with error **131047**; Meta's guidance is not to retry it.

This single fact drives most of the product. The inbox cannot offer a free-text composer to a contact whose window has closed — it must detect the closed window and force template selection instead of queueing a send that is guaranteed to fail (see §14 Inbox).

- **PC-1** — The system must store, for each pair of (CITS sender number, contact), the CSW expiry timestamp, opened or reset on every inbound message or call, and taken from the `conversation.expiration_timestamp` field on the `sent` status webhook where available.
- **PC-2** — The system must never allow a free-form (non-template) message to be enqueued when the CSW for that pair is closed or unknown. The composer must be hard-blocked and an approved template offered instead.
- **PC-3** — On receiving error 131047 **on the `/messages` surface**, the system must mark the message failed under the `CONDITIONAL` class — the condition being that the customer service window reopens — mark the CSW closed, and surface a "window expired — send a template instead" action. It must never retry the same free-form payload. Note that 131047 on `/block_users` means something entirely different ("target has not messaged in 24 hours"), which is why the error classification table is keyed on **(api_surface, code)** and never on the code alone (see §2.12 and the error-handling section).

### 2.2 Pricing model

Since **2025-07-01** Meta charges **per message, not per conversation.** Any cost model built around 24-hour conversation buckets is wrong. You are charged **only when a template is delivered** — three delivered templates are three charges — and the price is a function of the **template category** and the **recipient's** country calling code, not CITS's country.

What is free today: service messages (free-form replies inside an open window, unlimited since 2024-11-01 — the old 1,000/month free tier no longer exists), and **utility templates delivered inside an open window**, which is the single biggest cost lever in the product. Marketing and authentication templates are **always** charged, with no in-window exemption.

India rates from the fact base:

| Category | Rate | Effective | Confidence |
|---|---|---|---|
| Marketing | ₹0.8631 | 2026-01-01 | **[Verify before build]** |
| Utility | ₹0.115 (free inside an open window until 2026-10-01) | held from 2026-01-01 | **[Verify before build]** |
| Authentication (domestic) | ₹0.115, always charged | held from 2026-01-01 | **[Verify before build]** |

**[Verify before build]** — every INR numeral above is a secondary transcription. Meta no longer renders India rates inline; they live in a downloadable INR rate-card file behind Business Manager. The direction, date, market and currency are primary-confirmed; **the numbers are not.** No INR figure may appear in a client quote until someone has downloaded Meta's INR rate card and confirmed it. Add **18% GST** on top (imported digital services).

Volume discounts apply to **utility and authentication only. Marketing has no volume discount at any volume.** Tiers are aggregated across the whole business portfolio, only charged messages count toward them, and they reset monthly.

- **PC-4** — All message rates must live in a configuration table keyed by (category, recipient country, currency, effective-from date, effective-to date). No rate may ever be hardcoded in application code.
- **PC-5** — Every rate row must carry a `confidence` field and a `source` field. Rows marked unverified must render with a visible "unverified rate" marker anywhere a cost is displayed.
- **PC-6** — Cost must be attributed on the **recipient's** country, derived from the E.164 number, never on the sender's country.
- **PC-7** — The system must never apply a volume discount to marketing messages.

### 2.3 The 2026-10-01 change

On **2026-10-01**, service messages become chargeable per message, and **utility templates delivered inside an open window stop being free.** Rates match the current utility/authentication rates per market; the "no volume tiers" caveat applies to service messages only.

This is roughly ten weeks after this document was written. It means every cost estimate the product produces must be **date-aware**: the same campaign costs different amounts depending on when it sends. Meta also revises rate cards quarterly and publishes exact October rates by 2026-09-01.

- **PC-8** — Every cost calculation must take an effective date and resolve the rate card in force on that date. Cost estimates for scheduled future campaigns must use the rate card that will be in force at the scheduled send time, not today's.
- **PC-9** — The system must model the pre-2026-10-01 case (in-window utility and service free) and the post-2026-10-01 case (both chargeable) as configuration, not as two code paths.
- **PC-10** — There must be an admin screen for loading a new rate card with an effective-from date, without a code deploy.

### 2.4 Messaging limits, and why they are pooled

A **messaging limit** is the number of **unique recipients** a sender may message **outside** customer service windows in a rolling 24 hours. The ladder is **250 → 2,000 → 10,000 → 100,000 → Unlimited**.

**Since 2025-10-07 these limits are calculated and set at the business portfolio level and shared by every phone number in the portfolio.** Because CITS owns one portfolio containing every client's number (decision D1 below), **all CITS clients draw from one daily cap.** Ten clients sending on the same morning compete for the same 2,000 unique recipients. This is the central scheduling constraint of the whole product.

Moving from 250 to 2,000 requires **one** of: Meta business verification, partner-led verification, or delivering 2,000 messages outside windows to unique users in a rolling 30 days using high-quality templates. **CITS's business verification is already approved, so the portfolio is at 2,000 from day one.**

Above 2,000, upgrades are **automatic and within about six hours** when both hold: messages are high quality across all numbers and templates, **and at least 50% of the current limit was used in the last 7 days.** The consequence is counter-intuitive and must be designed for: **sending a trickle never earns an upgrade.**

- **PC-11** — Messaging limits must be modelled on the **portfolio** entity, never on the phone number or the client. Every client's scheduler must draw from the same shared counter.
- **PC-12** — The system must track unique recipients messaged outside a CSW in a rolling 24 hours across the entire portfolio, and must refuse to enqueue sends that would exceed the current tier.
- **PC-13** — The scheduler must implement a **ramp policy** targeting roughly **55–70% of the current tier cap sustained across 7 days** when the portfolio is eligible to climb. This band is **CITS product policy**, derived from Meta's published 50%-in-7-days rule with headroom; Meta publishes no recommended figure.
- **PC-14** — Portfolio limit utilisation must be visible on the operator dashboard as a headline number, with the current tier and the 7-day utilisation percentage.
- **PC-41** — Where a campaign's recipient count exceeds the remaining portfolio daily headroom, the system must **block launch** rather than warn, state how many recipients cannot be reached today, and offer splitting the campaign across days as the only path forward (see §2.7 and the campaign section).

Do not build tier logic that assumes the 2,000 and 10,000 tiers will disappear — a widely repeated claim that Meta would remove them in early 2026 has been refuted by the deadline passing.

### 2.5 Throughput is not the same thing as messaging limits

Messaging limits cap **how many distinct people** you may reach in a day. **Throughput** caps **how fast** you may push messages. They are independent, and there are four separate throttles layered on top of each other, each with its own error code and its own correct response:

| Throttle | Scope | Value | Error (api_surface, code) | Response |
|---|---|---|---|---|
| Portfolio 24h unique-recipient cap | Portfolio | 250 / 2,000 / 10,000 / 100,000 / Unlimited | — (scheduler must self-limit) | Outer bound on campaign size |
| Per-number throughput | Phone number | 80 messages/sec default | (`/messages`, 130429) | Token bucket driven from the live value |
| Per-recipient pacer | (number, recipient) | ~1 message per 6 seconds **[Verify before build]** — the rate-limits page could not be retrieved | (`/messages`, 131056) | **Per-recipient** backoff, not global |
| Graph API call rate | App per WABA | 200 req/hr inactive, 5,000 active **[Verify before build]** | (Graph, 4) / (Graph, 80007) | Exponential backoff with jitter |

Note that 130429 on `/block_users` is a **request rate limit**, not a messaging throughput ceiling, and must be handled by a different limiter. This is exactly why the classification table is keyed on **(api_surface, code)**.

At CITS's year-one scale — under 10 clients and under 50,000 messages a month — throughput is not a real constraint. A single-worker sender at a few messages per second is ample. The point of PC-15 is that the *shape* must be right so growth is not blocked.

- **PC-15** — The sending engine must implement all four throttles as distinct, independently configurable limiters. A single global rate limiter is not sufficient.
- **PC-16** — Per-number throughput must be read live from Meta rather than assumed, and must drive the limiter's rate.

### 2.6 Quality rating

Each phone number carries a quality rating of **green, yellow or red**, computed from the **last 7 days** of user feedback: blocks, reports, mutes, archives, and the reasons users give when blocking. Meta does not publish the algorithm, the thresholds, or the weightings.

The important change: **since 2025-10-07 the "Flagged" phone-number state no longer exists, and a quality drop no longer downgrades your messaging limit.** The old "seven consecutive flagged days costs you a tier" rule is dead. Quality has not stopped mattering — it now bites through **template pacing, template pausing and policy enforcement** instead (§2.7).

- **PC-17** — The system must record quality rating changes from the `phone_number_quality_update` and `message_template_quality_update` webhooks as time-series events, at both number and template level.
- **PC-18** — Any block-rate, read-rate or failure-rate threshold used to pause or alert must be stored as tenant-configurable configuration and labelled in the UI as **CITS product policy, not a Meta rule.** The product must never display an invented Meta threshold.

### 2.7 Template pacing and portfolio pacing

This is the constraint most likely to surprise the developer, because it makes campaign sending **non-deterministic**.

**Template pacing** applies to marketing and utility templates that are new, recently unpaused, or not rated green. Meta sends an initial portion normally, then starts returning `held_for_quality_assessment` instead of `accepted` for the rest. If early feedback is good, held messages are released. If it is bad, the template is **paused and every held message is dropped** with `status: failed` and code **132015**. After a pause, utility templates stay paced for 7 days.

**Business portfolio pacing** applies to **all** template categories for portfolios that have sent fewer than **500,000 template messages in a rolling 365 days**. The arithmetic matters and must be stated correctly: at CITS's year-one ceiling of just under **50,000 template messages a month**, a full twelve months would total close to 600,000 — *above* the threshold. The portfolio therefore sits inside the pacing regime for roughly the **first ten months** and exits only if that volume is sustained. Portfolio pacing is the **default** state in year one, not a permanent condition, and the rolling-365-day count must be read as **live data** rather than assumed to stay below the threshold.

Under portfolio pacing an initial set goes out; the remainder is batched and released only as feedback returns. Bad signals mean the **entire remaining queue is dropped** with code **135000**, and the portfolio is blocked from sending or creating templates pending review.

Meta deliberately publishes no pacing thresholds or batch sizes. They must be detected empirically from the `message_status` field in the send response.

**The product consequence, stated loudly: campaigns must be interruptible, and batch 1 must be independently useful, because batch 2 may never be sent.** A campaign that only makes sense if all 2,000 recipients get it is a campaign design the platform cannot honour.

- **PC-19** — `held_for_quality_assessment` must be a distinct message state. It must never be counted as sent, never be retried, and must be visible as its own number in campaign reporting.
- **PC-20** — Campaigns must be modelled as interruptible batches with a `remaining` state. The campaign UI must display "batch 1 released; remainder pending Meta quality assessment" whenever held messages exist.
- **PC-21** — On any failure carrying 132015 or 135000, the system must immediately stop the remainder of the campaign, move the campaign to the **`stopped_by_meta`** state, and raise an operational alert. It must never retry these codes.
- **PC-22** — Campaign creation must warn the author that partial delivery is a normal outcome, and must not present a scheduled campaign as a guaranteed send. A campaign that ends with some recipients delivered and a dropped remainder is reported in the **`partially_delivered`** state.
- **PC-42** — The rolling-365-day portfolio template-message count must be maintained as live data and surfaced on the operator dashboard alongside the 500,000 threshold, so operators can see whether the portfolio is still inside the pacing regime rather than guessing.

### 2.8 The per-user marketing cap

Independently of everything above, Meta enforces a cap on how many **marketing** template messages a single WhatsApp **user** receives — **across all businesses**, not just CITS. It is dynamic per person, driven by that person's recent marketing read rate and inbox fullness. India is in scope.

**Meta deliberately publishes no number.** The widely repeated figure of "2 marketing messages per user per day" **is not in Meta's documentation and must never appear anywhere in this product** — not in the UI, not in tooltips, not in help text, not in a sales deck.

Blocked sends come back as `failed` with error **131049**. Meta warns that excessive retries can make delivery to that user unavailable for up to 24 hours. Messages sent inside an open CSW after a user replies do not count toward the cap.

Separately and independently, CITS operates its **own** frequency governor: a configurable per-contact ceiling on marketing messages per rolling period, set per client and platform-wide (**CITS product policy**, suggested default 4 per 30 days per client). It is enforced in the pre-send suppression check and appears in the pre-flight summary as its own named exclusion reason. It must never be described to a user as a Meta rule.

- **PC-23** — Error 131049 must be treated as terminal for at least 24 hours for that recipient. The system must never blind-retry it.
- **PC-24** — 131049 must be reported as **"blocked by frequency cap"** — a first-class campaign metric alongside delivered and failed — and must never be presented as a content failure or a bad number. It must never be summed into the failure rate (see PC-43).
- **PC-25** — The product must never offer, imply or document any feature for evading the per-user cap using additional numbers, WABAs or providers. The cap is enforced on the user's side and would not work.
- **PC-43** — Rate definitions are fixed platform-wide. **Failure rate** = failed ÷ final recipients. **Non-delivery rate** = (failed + dropped by pacing + blocked by frequency cap) ÷ final recipients, always displayed with its three components itemised. Messages blocked by the per-user marketing frequency cap (131049) and messages dropped by Meta's pacing must never enter the failure-rate numerator. Any rate whose numerator was never captured inside Meta's 7-day analytics window must render as **"not captured"**, never as zero.
- **PC-44** — The CITS-side frequency governor must be a per-workspace and platform-wide setting, enforced in the pre-send suppression check, surfaced in the pre-flight summary as its own exclusion reason, and labelled in the UI as CITS product policy.

### 2.9 Template categories

There are exactly three: **Marketing**, **Utility**, **Authentication**. "Service" is a pricing category for free-form in-window replies, not a template category, and must not appear as a choice in the template composer.

Utility requires **both** that the content is non-promotional with no persuasive intent, **and** that it is either specific to/requested by the user or essential to them. Mixed content becomes marketing. Content whose intent cannot be determined becomes marketing.

At the fact base's India rates this distinction is worth roughly **7.5x** on price (₹0.8631 vs ₹0.115), plus utility is free inside an open window until 2026-10-01. **[Verify before build]** — INR numerals are secondary transcription; confirm against Meta's INR rate card. For CITS's clients: calls for papers, conference announcements and membership renewal pushes are marketing; submission-received, review-assigned, payment-receipt and event-reminder messages are utility; OTPs are authentication.

Templates are owned by a client and live on exactly **one WhatsApp Business Account (WABA)** — never on a sender number. A template is usable by any sender number attached to that WABA, and the 250/6,000 template ceiling and the name-uniqueness rule apply **per WABA per language** (see §2.12 D1 and the templates section).

Two corrected behaviours the developer must know:

1. **Utility → Marketing recategorisation runs daily and continuously**, not monthly (it changed on 2024-11-01). Normally there is **1 day of advance notice**. Since **2025-04-16, businesses previously warned for categorisation misuse get no advance notice at all** — the category flips immediately with notification after the fact. Only the separate authentication-rejection path is monthly.
2. **Since 2025-04-09, `allow_category_change` is the default.** A template submitted as utility that Meta judges to be marketing is **silently approved as marketing** rather than rejected. An over-optimistic utility submission does not fail loudly — it just costs 7.5x more per message, forever, until someone notices.

- **PC-26** — The template composer must offer only Marketing, Utility and Authentication, and must show a projected per-message cost delta between the selected category and marketing before submission.
- **PC-27** — The system must subscribe to the `template_category_update` webhook and must additionally poll templates for a mismatch between `category` and `correct_category`, which signals a pending recategorisation. Both must raise an alert to the owning client's operator.
- **PC-28** — When a template is approved in a different category than submitted, the system must flag it prominently as "approved as MARKETING — cost is 7.5x your estimate" and must recompute any campaign cost estimate that referenced it.
- **PC-45** — A campaign may be created and scheduled against a `PENDING` template, with a visible warning. The **sending engine** must refuse to release any message whose template is not `APPROVED` for the exact language being sent. `PAUSED`, `DISABLED` and `REJECTED` templates remain visible but unselectable.

### 2.10 The United States marketing block

Since **2025-04-01**, WhatsApp does not deliver marketing template messages to United States phone numbers — defined precisely as numbers with a **+1 dialling code AND a US area code.** No end date has been announced. Utility templates, authentication templates and in-window replies to US numbers are unaffected.

Precision matters here: **Canadian and Caribbean numbers also use +1 and are not affected.** A blanket +1 block would silently exclude legitimate Canadian society members and Caribbean delegates.

- **PC-29** — The system must classify +1 numbers by area code and suppress marketing templates only to US area codes. It must never blanket-block +1.
- **PC-30** — US-area-code recipients excluded from a marketing campaign must be reported as a named exclusion reason on the campaign preview, before sending, not as a failure afterwards.

### 2.11 There is no way to check whether a number is on WhatsApp

The old `/contacts` endpoint that could pre-check numbers existed **only on the On-Premises API**, and the On-Premises API's final client expired **2025-10-23**. **No contact-validation endpoint exists on the Cloud API.** You cannot ask Meta whether a number is on WhatsApp before you send.

This has direct consequences for list hygiene. Deliverability can only be inferred after the fact, from delivery outcomes — and even that is noisy. Error **131026 ("message undeliverable")** is heavily overloaded: it also fires for out-of-date WhatsApp clients, unaccepted terms of service, and Meta declining on policy or quality grounds. A single 131026 does not mean a bad number.

The four contact deliverability states are `unknown`, `deliverable`, `suspect` and `invalid`. The distinction that matters here is that **`invalid` is reserved for syntactic validation failure only** — a number that does not parse as E.164. Delivery evidence never produces `invalid`.

- **PC-31** — The system must never claim to validate whether a number is registered on WhatsApp, and must never integrate a third-party "is this number on WhatsApp" checking service. Such services are unofficial and carry policy risk.
- **PC-32** — Delivery evidence must never set a contact to `invalid`. Repeated 131026 outcomes may move a contact to **`suspect`** only, and only after **N** occurrences of error 131026 spread across at least **M** distinct campaigns and at least **D** distinct calendar days. N, M and D are **CITS product policy**, configurable, with defaults **N=3, M=2, D=2**. A single 131026 changes nothing. The transition must be operator-reversible and audit-logged. `invalid` is set only by syntactic E.164 validation failure at import or edit time (see §9 Contacts and contact import for the full state definitions).
- **PC-33** — List hygiene must be driven by consent recency, engagement history and observed delivery outcomes. Import-time validation is limited to E.164 format and mobile-capability checks (see §9 Contact import).

---

### 2.12 Decisions and accepted risks

#### D1 — CITS owns the WABAs; one dedicated phone number per client

**Decision.** All WhatsApp assets sit inside CITS's single, already-verified business portfolio. Each client's templates live on that client's WABA inside the portfolio, and each client gets one dedicated phone number carrying that client's display name. Nothing is owned by the client.

**Rationale.** It is the only structure a solo developer can stand up quickly with no Meta partner onboarding, no per-client payment methods, and no per-client business verification. Small Indian societies and journals frequently cannot complete Meta Business Verification or attach an international payment method, so the alternative model would stall at onboarding.

**Divergence from the research — stated plainly.** The source research **explicitly rules this structure out** and recommends the Tech Provider model with **client-owned WABAs**, on two grounds: pooled blast radius (quality, pacing and enforcement act at portfolio level, so one client's bad list can degrade or block sending for all of them) and the fact that **a WABA can never be migrated between portfolios**, making the arrangement a one-way door for every client onboarded under it. CITS **accepts that finding as correct** and overrides it for v1 on **schedule and onboarding-friction grounds alone** — not because the risk is disputed. The two alternatives the research preferred were considered and rejected for v1:

| Rejected alternative | Why it is better | Why it was rejected for v1 |
|---|---|---|
| **Tech Provider with client-owned portfolios and WABAs** | Clean per-client isolation; no shared blast radius; clients can leave with their assets | No per-message margin for CITS; requires each client to attach their own payment method and complete their own Meta Business Verification — which the target clients frequently cannot do; requires App Review and Embedded Signup build-out |
| **A BSP base such as 360dialog** | CITS captures markup on message volume; faster than becoming a Tech Provider | Reintroduces the WABA-ownership question rather than settling it, and adds a third-party dependency in the send path |

Both remain the **documented exit routes** and are specified in **D5**. **This decision is reversible only for new clients** — an existing client's number, templates, quality history and conversation history cannot follow them out of CITS's portfolio under any of the routes above.

**Accepted risks, stated plainly:**

| Risk | Consequence |
|---|---|
| Pooled messaging limits | Every client shares one 24-hour unique-recipient cap. A big campaign for one society consumes another society's headroom the same day. |
| Shared blast radius | Quality, pacing and enforcement act at portfolio level. One client's bad list degrades template pacing and can, at the extreme, block template sending for **all** clients. |
| No handover, ever | A WABA belongs to exactly one portfolio and **can never be migrated.** A client who leaves cannot take their number, templates or history. This is a one-way door taken knowingly. |
| Number ceiling | New portfolios are capped at **2 phone numbers**, rising to **20** after business verification. CITS's verification is done, so the working ceiling is ~20 numbers — roughly 20 clients before a direct arrangement with Meta is required. |
| Display-name policy exposure | Where a display name represents a *different* business, the relationship must reportedly be evident on both parties' websites and the represented business must itself be Meta verified. **[Verify before build]** — this wording comes from a BSP, not from Meta, and must be confirmed against Meta's own help article before it is treated as a hard onboarding rule. |

- **PC-34** — Client onboarding must record a documented representation relationship (contract reference and a public-facing acknowledgement) for every display name registered on a client's behalf, so the display-name requirement can be evidenced if challenged.
- **PC-46** — The data model must place templates on the **WABA**, not on the phone number: one client, one WABA, many sender numbers able to use the same template. Template count ceilings (250/6,000) and name uniqueness must be enforced **per WABA per language**.

#### D2 — No Tech Provider, no Embedded Signup, no App Review in v1

**Decision.** v1 uses a business system user token against CITS's own WABAs. There is no Meta App Review submission, no Embedded Signup integration, and no Tech Provider or Solution Partner onboarding.

**Why this is legitimate here.** App Review, Advanced Access and Embedded Signup exist so that a provider can act on **assets belonging to someone else**. Under D1 there is no third-party asset — CITS is operating inside its own verified portfolio on WABAs and numbers it owns. A system user token scoped to those WABAs is the documented, supported way to do exactly that.

**This is a large scope saving and should be recognised as one.** It removes: Meta App Review (icon, hosted privacy policy, two screen recordings, an unpredictable review queue), the Embedded Signup v4 popup and its 30-second code exchange, per-tenant business token storage and refresh, and the 10-new-customers-per-week onboarding cap. For a solo developer serving fewer than 10 clients, all of it is avoidable work.

- **PC-35** — v1 authentication to Meta must use a system user token per WABA, stored encrypted at rest, never exposed to the browser, with a documented rotation procedure. Prefer an **employee** system user granted access per WABA over an admin system user, which receives access to everything by default. Token health must be checked **every 6 hours**.

#### D3 — Internal use only; no billing in v1, but full cost attribution from day one

**Decision.** v1 is operated by CITS staff. There is no client login billing screen, no invoice generation and no payment collection. However, every message's cost is attributed to a client from the first message sent.

**Rationale.** Cost attribution is cheap to build at write time and effectively impossible to reconstruct later — Meta bills CITS as one entity, and since Graph API v24.0 the `pricing` object no longer appears on `delivered` and `read` webhooks. If it is not captured when the message is sent, the data is gone. Attribution is the foundation of any future charging model and of the "show Meta's rate and our fee as separate line items" positioning.

- **PC-36** — Billing reconciliation must read the `pricing` object off the **`sent`** status webhook, not `delivered` or `read`.
- **PC-37** — Every outbound message record must carry client, campaign, template **version**, category, recipient country, resolved rate and rate-card version at send time. These must be immutable once written.

#### D4 — WhatsApp only

**Decision.** v1 sends on WhatsApp and nothing else. No SMS, no email, no Instagram, no in-app push.

**Rationale.** Every additional channel brings its own regulatory regime — SMS in India brings TRAI DLT sender-ID and template registration, which does **not** apply to WhatsApp. Adding one channel would roughly double the compliance surface for a product serving under 10 clients.

- **PC-38** — The data model must name the channel explicitly on messages, templates and campaigns rather than assuming WhatsApp, so a second channel is an addition rather than a rewrite. No second-channel logic is to be built in v1.

#### D5 — The exit ramp

If CITS later needs true per-client isolation — because pooled limits become the binding constraint, because a client demands ownership, or because one client's quality problem starts damaging others — the two documented routes, both named in D1, are:

**Route A — Tech Provider with client-owned portfolios (the structure the research recommends):**

1. Register CITS as a Meta **Tech Provider**, complete App Review for Advanced Access on `whatsapp_business_messaging` and `whatsapp_business_management`, and build an **Embedded Signup v4** onboarding flow.
2. Have each **new** client create their own business portfolio, complete their own Meta Business Verification, attach their own payment method, and onboard their own WABA and number through that flow.
3. Store one business token per client tenant and route all sends through the tenant's own WABA.

**Route B — move onto a BSP base (for example 360dialog):** faster to reach than Tech Provider status and it lets CITS capture a markup on message volume, but it does not settle the WABA-ownership question — it re-asks it, this time with a third party in the send path.

**The honest statement: existing client numbers cannot come along, on either route.** A WABA created inside CITS's portfolio can never be migrated to another portfolio. Migrating an existing client means that client obtains a **new** phone number in their own portfolio, re-submits every template for approval, and starts from a fresh messaging-limit tier and a fresh quality history. Conversation history stays behind. There is no partial or gradual migration path for an existing number, and no amount of engineering on CITS's side changes that. **D1 is therefore reversible only for new clients.**

- **PC-39** — The data model must scope every entity by client from v1 (see §21 Data model) and must never assume that all clients share one WABA, one portfolio or one token, so that the D5 path is an integration change rather than a rewrite.
- **PC-40** — Client contracts and onboarding material must state, before a number is provisioned, that the number is owned by CITS and cannot be transferred. This must be an explicit acknowledgement, not a footnote.

---

## 3. Technology stack

### 3.1 Decision table

| Layer | Choice | Version floor | Why |
|---|---|---|---|
| Runtime | Bun, Docker image `oven/bun:1.3.14` | exact tag, never `latest` | Every dependency in this stack is pure JavaScript, so Bun's weakest area (native add-ons) does not apply |
| HTTP framework | Hono | `^4.12` | Fast release cadence, OpenAPI and JWT/CORS/logger middleware, and it runs unchanged on Node — a real escape hatch |
| ORM | Drizzle | **`>=0.45.2` mandatory** | SQL-shaped queries make tenant scoping explicit and reviewable; 0.45.2 fixes a SQL-injection flaw |
| Database | PostgreSQL | 16 or later | One transactional store for contacts, consent, outbox and audit; row-level security available if needed |
| Queue | BullMQ | `>=5.80.9` | Rate limiting, delayed jobs, pause/resume, parent-child flows — the exact shape of WhatsApp throttling |
| Queue datastore | Valkey (not Redis) | current stable | BSD-3-Clause, no copyleft or service-restriction ambiguity; wire-compatible with Redis |
| Queue fallback | pg-boss | 12.26.1 | Documented alternative if the Bun/Valkey path fails its spike |
| Frontend | Next.js, separate container | `^16.2` | Independent deploy cadence from the webhook receiver and workers |
| Auth and RBAC | Better Auth + Organization plugin (+ Admin plugin) | `^1.6` | Ships organisations, members, teams, invitations and roles; native Drizzle and Next.js adapters |
| Spreadsheet import | exceljs | 4.4.0 | MIT-licensed XLSX reader. The npm `xlsx` package is **banned** |
| CSV import | papaparse (or fast-csv) | current | Streaming CSV parse for large member lists |
| Phone numbers | libphonenumber-js, `max` or `mobile` metadata | `^1.13` | Normalise to E.164 at ingest; incorrect formatting silently misdelivers |
| Error tracking | Sentry SaaS | `@sentry/bun` 10.50.0 is **beta** | Fall back to `@sentry/node` under Bun if gaps appear; GlitchTip is the self-hosted fallback |
| Logs | Structured JSON to stdout | — | Collected by Docker; no log platform in v1 |
| Uptime | External check (Better Stack / UptimeRobot) | — | Must be outside the VPS or it cannot report the VPS being down |
| Deployment | Docker Compose, single Linux VPS | — | Honest fit for under 10 clients and under 50,000 messages a month |

**TS-1.** The system must pin every container image to an exact tag. The Bun image must be `oven/bun:1.3.14`. `latest` must never appear in any Compose file or Dockerfile.

**TS-2.** The system must fail its build if Drizzle ORM resolves below 0.45.2.

**TS-3.** The npm package `xlsx` must never appear in the dependency tree, directly or transitively. A dependency check in CI must enforce this.

### 3.2 Why these, where the reasoning is not obvious

**Bun and the pin.** A pinned tag means the runtime you soak-tested is the runtime that runs in production. `latest` means a routine `docker compose pull` can swap the runtime under a live queue worker with no code change and no review — the worst possible way to discover a garbage-collection or file-handle regression. Pinning also makes upgrades a deliberate, testable change with a rollback target.

**Hono over Elysia.** Throughput is not the constraint here; a webhook receiver handling a few thousand events a day is not performance-bound. What matters is the escape hatch. Hono is runtime-agnostic and runs on Node without code changes. If Bun proves unstable under long-running load, the API and workers move to Node by changing the base image and the start command. Elysia is Bun-specific, so choosing it would make the runtime decision irreversible.

**Drizzle and tenant scoping.** Every client's data lives in the same database. The single most dangerous class of bug in this product is a query that forgets its client filter and returns one society's members to another. Drizzle queries look like SQL, so a human (or an AI coding assistant's reviewer) can read a query and see the tenant predicate. Versions before 0.45.2 carry a SQL-injection vulnerability in `sql.identifier()` and `sql.as()`, which is exactly the code path used for dynamic column and table names — unacceptable in a multi-client system. Prisma 7 is the runner-up: better migration tooling, and its Rust engine is gone, but there is still no first-party Bun adapter (the upstream issue is open). Choose Prisma only if the Drizzle path fails, and spike Bun compatibility first.

**Drizzle and the structural keys.** Two uniqueness constraints in this system are load-bearing and must be expressed as database constraints, not application checks: send outbox uniqueness on **(campaign_id, recipient_id, template_version_id, attempt_key)** — on the immutable `template_version_id`, never the mutable template id — and status event dedupe on **(wamid, status)** only, with the provider timestamp stored but deliberately outside the key so that a redelivery carrying a different timestamp is still absorbed as a conflict. Drizzle is chosen partly because these constraints and the insert-on-conflict paths that rely on them are readable in review.

**BullMQ config — two rules that are not optional.** Worker connections must set `maxRetriesPerRequest: null`; without it, BullMQ's blocking commands break. An ioredis `keyPrefix` must never be set on a BullMQ connection — it collides with BullMQ's own key prefixing and corrupts queue state. Use BullMQ's `prefix` option instead, which is also how the tenant or environment namespace should be expressed.

**Valkey over Redis.** Redis 8.0+ is tri-licensed under AGPLv3, RSALv2 and SSPLv1. Valkey is plain BSD-3-Clause under the Linux Foundation, wire-compatible, and the default package in Debian, Ubuntu, Fedora and Arch. For a company that may later sell or white-label this software, the licensing clarity is worth more than any feature difference.

**Next.js as its own container.** The webhook receiver must acknowledge Meta's callbacks in milliseconds, continuously, and the queue workers must run for hours at a time. Neither behaviour belongs in a Next.js route handler: frontend deploys would restart the webhook endpoint, and serverless-style request handlers have no place to keep a long-lived worker loop. Splitting them means a UI deploy can never cause missed webhook deliveries.

**Better Auth.** Multi-tenant session handling, invitations, role checks and organisation switching are where hand-rolled auth goes wrong, and the failure mode is a client seeing another client's data. Better Auth's Organization plugin models exactly the shape needed: the application-level **Super Admin** role held on the user record, and the four per-workspace roles **Client Admin**, **Campaign Manager**, **Inbox Agent** and **Viewer** held per membership (see §6 Users, roles and permissions). Note that "View full phone numbers" is a distinct permission rather than a role, and must be modelled as such. Rolling your own JWT and session layer for a multi-tenant product is out of the question. Lucia is deprecated as of March 2025 and is now only a tutorial. Auth.js/NextAuth is treated as maintenance-mode; the claim that it has folded into Better Auth is **[Verify before build]** — secondary-sourced, confirm on authjs.dev before citing it anywhere client-facing.

**libphonenumber-js and the leading plus.** Meta's documented behaviour: if the `+` is omitted from the `to` field, **your sender number's country calling code is prepended to the recipient's number.** An India-registered sender given the US-format number `(631) 555-1234` delivers to `+916315551234` — a real, wrong, Indian number. The message sends, is billed, and may be delivered to a stranger. **TS-4.** The system must normalise every phone number to E.164 at ingest, store only E.164, and must never send a `to` value without a leading `+`. **TS-5.** For Indian numbers the system must strip a leading `0`, strip a duplicated `91`, and reject any value that does not validate as a mobile-capable IN number. A number that fails this syntactic validation is the only thing that may set a contact's deliverability state to `invalid`; delivery evidence never does.

### 3.3 Required spikes before architecture freeze

Each is a gated task with a defined failure action. None should take more than a day except the soak test.

| Spike | Question | If it fails |
|---|---|---|
| **S1 — BullMQ on Bun** | Does BullMQ `>=5.80.9` run reliably on Bun 1.3.14 using the Bun native Redis adapter (`createBunRedisClient`), including delayed jobs, rate limiting and worker restarts? | Use ioredis under Bun instead. If that also fails, switch to **pg-boss 12.26.1** — note it declares `engines: node >= 22.12.0`, so spike that too (5 minutes). |
| **S2 — Valkey version and Lua** | Does the chosen Valkey release satisfy BullMQ's minimum Redis version and Lua scripting requirements? BullMQ's scripts are the load-bearing part. | Pin a Valkey release that does. If none does, fall back to pg-boss rather than re-introducing Redis 8 licensing. |
| **S3 — 72-hour Bun soak** | Under representative bulk-send load (a simulated 5,000-recipient campaign plus continuous webhook traffic), does resident memory stay flat over 72 hours? | Move API and workers to Node using the same Hono code and the same pinned dependency set. Keep Bun only for local tooling. |

**TS-6.** The architecture must not be frozen, and no client data may be loaded, until S1, S2 and S3 have each recorded a written pass or a recorded fallback decision.

**TS-7.** Do not cite any "Bun is X% Node-compatible" figure as evidence in either direction. All such numbers are blog folklore; S3 is the only evidence that counts.

### 3.4 Environment, configuration and the data-not-code rule

**In environment variables and a secrets file that is never committed:** database and Valkey connection strings, the Meta business system user token, the Meta App Secret (used to verify webhook signatures), the webhook verify token, the Better Auth secret, the Sentry DSN, and the encryption key that protects tokens at rest. **TS-8.** The application must refuse to start if any required secret is missing, rather than starting with a default.

**In the database:** everything a non-developer might need to change. Specifically, and this is the rule that matters most:

**TS-9.** Meta message rate cards, the Meta error classification table, and all quality and block-rate thresholds must live in database tables, not in source code, and must be editable by an administrator without a deploy. The classification table must be keyed on **(api_surface, code)**, never on code alone, and its five classes are `RETRY_BACKOFF`, `TERMINAL`, `CONDITIONAL`, `PROBABLE_INVALID_CONTACT` and `OPERATIONAL_ALERT`. Keying on the pair is not optional: Meta reuses codes across endpoints with different meanings — 131047 is "customer service window expired" on `/messages` but "target has not messaged in 24 hours" on `/block_users`; 130429 is a throughput ceiling on `/messages` but a request rate limit on `/block_users`; 131021 is sender-equals-recipient on `/messages` but a self-block on `/block_users`. A table keyed on code alone would silently mis-handle three of the most common codes in the system.

The reason is in the fact base: Meta changes rates on announced dates (India's marketing rate rose on 2026-01-01; service and in-window utility messages become chargeable on 2026-10-01), publishes new error codes without notice, and publishes **no** quality thresholds at all. Every threshold in this document is therefore CITS product policy, not a Meta rule, and must be labelled as such wherever it appears in the UI. Rate cards must be stored with an effective-from date so historical cost attribution stays correct after a rate change (see §17 Usage and cost tracking).

**TS-10.** Client-specific settings — sender number, display name, the **typed-confirmation threshold** (default 500 recipients), the **campaign approval threshold** (default 1,000 recipients), and the CITS-side frequency governor ceiling (suggested default 4 marketing messages per contact per 30 days per client) — must live in the database keyed by client, never in environment variables. Each carries a platform-wide default that a workspace value overrides. The stored approval threshold must never be accepted below the stored typed-confirmation threshold. All of these are CITS product policy, not Meta rules. Adding a client must never require an environment change or a redeploy.

**TS-11.** The single-valued operational settings — `unresolved_send_age` (6 hours), `reply_attribution_window` (7 days, CITS product policy) and the token health check cadence (every 6 hours) — must each be stored once in the database and read by every consumer. `unresolved_send_age` is read identically by the reconciliation sweep, the dashboard tile and the alert; `reply_attribution_window` is read identically by inbox attribution and by campaign "Replied" and "Opted out" counts. Duplicating either value in code or per-feature configuration is a defect.

---

## 4. Architecture

### 4.1 Processes and why each exists

The system runs as a small set of independent containers on one Linux virtual private server, orchestrated by Docker Compose. Each process exists because it has a different failure mode, a different deploy cadence, or a different latency budget from the others.

| Process | What it does | Why it is separate |
|---|---|---|
| Web app (Next.js 16) | Everything a human sees: campaigns, contacts, templates, inbox, reports | Front-end deploys are frequent and cosmetic; they must never take the message pipeline down |
| API (Bun + Hono) | All business logic and data access, called by the web app over HTTP | Single place where tenant scoping, permissions and validation are enforced |
| Webhook receiver (Bun + Hono, separate container) | Receives inbound messages, delivery statuses, template and quality events from Meta | Has a millisecond latency budget and must stay up during every other deploy |
| Send worker | Drains the send queue, calls Meta, applies throttles and backoff | Long-running, stateful pacing; must be pausable without stopping the API |
| Import worker | Parses uploaded spreadsheets and CSV files | CPU- and memory-heavy; must never block a web request (see §9 Contact import) |
| Scheduler worker | Timer-driven work: campaign launches, analytics polling, token and quality checks | Needs exactly-one-runner semantics |
| PostgreSQL | The system of record for every message, contact, consent record and status event | Meta retains message data for only 30 days and is not our system of record |
| Valkey | BullMQ queue backend, rate-limit token buckets, short-lived caches | Losing it must degrade sending, never lose data |
| Click redirect service | Serves the short-link domain, logs the click, 302s to the destination (see §16 Click tracking) | Public, unauthenticated, latency-sensitive, and separately attackable |

**AR-1** The system must run the web app, API, webhook receiver, send worker, import worker, scheduler worker and click redirect service as separately restartable containers.

**AR-2** The webhook receiver must be deployable and restartable without stopping or restarting the API, the web app or any worker.

**AR-3** Every process must emit structured JSON logs to standard output and report uncaught errors to Sentry, tagged with the client organisation and, where applicable, the campaign and message identifiers.

#### Why the webhook receiver is its own process

Meta does not wait. If our endpoint is slow or returns an error, Meta retries — and retries fan out to every subscribed app, are explicitly documented to produce duplicates, and can arrive in batches of up to 1,000 updates. A slow handler therefore does not just delay one event; it multiplies traffic while the system is already struggling. The receiver's only job is: check the signature, write the raw bytes to durable storage, enqueue a processing job, return HTTP 200. Nothing else. All interpretation happens later, in a worker, where slowness is harmless.

**AR-4** The webhook receiver must acknowledge with HTTP 200 before performing any interpretation of the payload, and must do no work other than signature verification, durable persistence and enqueueing.

**AR-5** The webhook receiver must never call the Meta API, never send email or notifications, and never perform multi-table business writes inside the request path.

### 4.2 Three request-path walkthroughs

**(a) A campaign is launched and a message reaches a recipient**

1. A user clicks Launch in the web app; the web app calls the API.
2. The API runs pre-flight (template approved for the exact language, consent state, suppression list including the CITS frequency governor, client status not `suspended`, sender number healthy, portfolio headroom sufficient — see §12 Campaigns) and, in one database transaction, writes one outbox row per recipient in state `queued`. A campaign at or above the campaign approval threshold cannot reach this step until it has been approved by a Client Admin or Super Admin.
3. The API enqueues one send job per outbox row on the BullMQ send queue.
4. The send worker picks up a job, re-checks the recipient against the suppression list and the portfolio's remaining daily unique-recipient allowance, and passes the throttle gates.
5. The worker calls Meta's send endpoint, passing the internal send id as `biz_opaque_callback_data`.
6. Meta replies with a message id and a `message_status` of `accepted`, `held_for_quality_assessment` or `paused`. The worker records the message id and moves the row to `accepted` — **not** to `sent`.
7. Meta later delivers the message and reports the real outcome by webhook.

**(b) An inbound reply arrives and lands in the inbox**

1. Meta posts a `messages` webhook to the receiver.
2. The receiver verifies the signature, writes the raw payload, returns 200, and enqueues an inbound-processing job.
3. The worker parses the envelope, resolves the receiving phone number to a client organisation, and matches or creates a contact from the sender's number.
4. The worker opens or resets that contact's 24-hour customer service window and appends the message to the conversation thread, which is in state `open` or `closed`.
5. If the message body matches a stop-word rule, the opt-out path runs (see §10 Consent and opt-out).
6. Any media referenced by the message is downloaded and stored within seven days, because Meta expires inbound media identifiers after that.
7. The inbox refreshes for the user holding Inbox Agent.

**(c) A delivery status webhook updates a message's state**

1. Meta posts a `statuses` webhook; the receiver verifies, persists, 200s, enqueues.
2. The worker looks up the message by message id, falling back to the echoed `biz_opaque_callback_data` send id if the message id is unknown.
3. The worker appends a row to the append-only status-events table.
4. The derived current status is recomputed by monotonic rank, so a late-arriving `delivered` cannot overwrite an already-recorded `read`.
5. Billing-relevant fields are read off the `sent` event, because from Graph API v24.0 onward the `pricing` and `conversation` objects no longer appear on `delivered` and `read` for ordinary conversations (see §17 Usage and cost tracking).
6. Campaign counters and dashboards are updated from the derived status, never from the raw event.

### 4.3 The webhook ingestion contract

**AR-6** The receiver must verify the `X-Hub-Signature-256` header as an HMAC-SHA256 of the **exact raw request bytes**, keyed with the Meta app secret, using a constant-time comparison. It must never re-serialise the parsed JSON before hashing — key order and whitespace differences will silently break verification.

**AR-7** Requests failing signature verification must be rejected without processing and counted as a security metric.

**AR-8** The receiver must persist the raw request body, headers and receipt time durably before returning 200, so that a processing bug can be replayed from our own store. Meta offers no replay API and no dead-letter queue.

**AR-9** Processing must be idempotent. Retries are guaranteed to produce duplicates. Meta's own documentation disagrees on retry duration — the WhatsApp page says up to 7 days, the general Graph page says 36 hours — so the system must tolerate at-least-once delivery for **at least 36 hours** and must not assume the longer bound. **[Verify before build]** the current retry window on Meta's live docs.

**AR-10** Events must be ordered by the `timestamp` field carried in the payload, never by arrival order. No ordering guarantee is published anywhere.

**AR-11** Status events must be deduplicated on the combination of **(wamid, status)** only, enforced by a database uniqueness constraint rather than an application check. The provider timestamp is stored on the row but is deliberately **not** part of the key: Meta redelivers the same status with a different timestamp, and including the timestamp would let every redelivery insert a second row into an append-only table, defeating the dedupe entirely. A conflicting insert is absorbed silently.

**AR-12** The verification handshake (a GET carrying `hub.mode`, `hub.challenge` and `hub.verify_token`) must validate the token and echo the challenge verbatim.

### 4.4 Idempotency and exactly-once sending

Meta provides no idempotency key. Exactly-once behaviour has to be constructed on our side.

**AR-13** Before any call to Meta, the send worker must write an outbox row carrying a system-generated internal send id, protected by a uniqueness constraint on **(campaign_id, recipient_id, template_version_id, attempt_key)**. If the insert conflicts, the send has already been attempted and must not be repeated. The key uses the template **version** id, never the mutable template id, because editing a template creates a new version and resets it to pending — two sends built from different versions are genuinely different messages and must not collide on one key.

**AR-13a** `attempt_key` is an integer starting at 1, incremented **only** by an explicit operator-initiated retry of a specific recipient set. Automatic retries inside the error-handling policy reuse the same `attempt_key` and are therefore idempotent — replaying them can only conflict, never duplicate. An operator retry creates new outbox rows under `attempt_key + 1` within the same campaign, and those rows appear in the same campaign report as a separate attempt rather than overwriting the first.

**AR-14** The internal send id must be passed to Meta as `biz_opaque_callback_data` (an arbitrary string, maximum 512 characters), which Meta echoes on every status webhook for that message. This is the only reliable way to reconnect a webhook to a send whose message id we failed to record.

**AR-15** The outbox row must be advanced only after the returned message id has been persisted.

**AR-16** On a network timeout or an ambiguous response, the system must **never resend**. It must mark the row as awaiting confirmation and wait for a status webhook carrying the send id. A webhook bearing our send id with a message id we do not hold proves the send landed; the message id must be backfilled onto the existing row.

**AR-17** Rows awaiting confirmation for longer than the `unresolved_send_age` setting — default **6 hours**, CITS product policy, not a Meta rule — must be surfaced as an "unresolved send" alert rather than silently retried. This is a single setting: the reconciliation sweep, the dashboard tile and the alert all read the same value, so the three can never disagree.

### 4.5 The message state machine

The states are `queued` → `accepted` → `sent` → `delivered` → `read`, plus `played` for the first playback of a voice message, plus `failed`, plus the separate limbo state `held_for_quality_assessment`.

**AR-18** HTTP 200 from Meta means accepted, not sent. The system must never display "sent" on the basis of the send call's response.

**AR-19** `held_for_quality_assessment` must be modelled as its own state. Messages in it must never be counted as sent, must never be retried, and must be shown to users as "held by Meta pending quality assessment." They may later resolve to delivered or to failed.

**AR-20** Status history must be stored in an append-only status-events table (message id, status, provider timestamp, received time, raw payload reference). The message's current status must be a derived value computed by monotonic rank, so a message can never regress from `read` back to `delivered`.

**AR-21** The system must tolerate a missing `delivered` event. When a message is delivered and read at the same moment, Meta may skip the `delivered` webhook entirely. A `read` event with no prior `delivered` must be accepted, not treated as corruption.

**AR-22** The system must tolerate both `delivered` and `failed` for the same message id, which multi-device users can produce. Delivery to at least one device counts as delivered; the failure must be recorded in history but must not override the delivered outcome.

**AR-23** Failure handling must branch on the error code in the JSON body, never on the HTTP status, using a classification table stored as data so it can be updated without a deploy. The table is keyed on **(api_surface, code)**, never on code alone, because Meta reuses codes across endpoints with different meanings — 131047, 130429 and 131021 all mean different things on `/messages` than on `/block_users`. Each key maps to one of the five classes `RETRY_BACKOFF`, `TERMINAL`, `CONDITIONAL`, `PROBABLE_INVALID_CONTACT`, `OPERATIONAL_ALERT` (see §13 Sending engine).

### 4.6 Scheduled and background work

| Job | Cadence | Why |
|---|---|---|
| Campaign schedule dispatcher | Every minute | Releases campaigns whose scheduled time has arrived |
| Template analytics warehousing | At least daily, and within 7 days of every send | Meta keeps read and click data for only **7 days from send**; after that it is gone permanently |
| General analytics warehousing | Daily | The analytics lookback was cut to **1 year on 2025-12-01**; older history exists only if we stored it |
| Token health check | **Every 6 hours** | Whether business system user tokens expire is not documented by Meta, so expiry must be detected rather than assumed. A daily check can leave sending dead for most of a day before anyone is told; six-hourly bounds the blind window to one pacing period and matches the cadence specified in the sender-numbers section |
| Quality and limit polling | Hourly | Backstop for missed `phone_number_quality_update` and `business_capability_update` webhooks |
| Pending-category detection | Daily | A template whose `correct_category` differs from its `category` is about to be recategorised |
| Unresolved-send sweep | Hourly | Finds sends with no terminal status older than `unresolved_send_age` (6 hours) |
| Portfolio rolling-365-day volume recount | Daily | Portfolio pacing applies below 500,000 template messages in a rolling 365 days; the count must be read as live data, never assumed |

**AR-24** The system must poll and store its own copy of template analytics within 7 days of every send. Data not captured in that window is permanently unrecoverable, and any rate whose numerator was never captured inside that window must render as **"not captured"**, never as zero.

**AR-25** Warehoused analytics must be stored as immutable daily snapshots, so reports remain reproducible after Meta's own lookback expires.

**AR-26** Scheduled jobs must be defined as BullMQ repeatable jobs with a single scheduler worker replica, and each run must be idempotent so that a duplicate run causes no double-send and no double-count.

### 4.7 Deployment topology, backup and restore

One Linux VPS, one Docker Compose file, one reverse proxy terminating TLS in front of three public entry points: the web app, the webhook receiver path, and the click redirect domain. PostgreSQL and Valkey are not exposed to the internet. Bun images are pinned to `oven/bun:1.3.14` — never `latest` — so a rebuild cannot silently change the runtime.

**AR-27** The webhook receiver and the click redirect service must each be reachable on a stable public HTTPS URL that does not change across deploys.

**AR-28** Backups must cover: the PostgreSQL database (nightly full plus continuous write-ahead log archiving), stored inbound media, raw webhook payloads, and the environment/secrets configuration held outside the repository. Valkey is deliberately excluded — queue state must be reconstructible from PostgreSQL.

**AR-29** A restore drill must be performed and documented before launch and at least once per quarter, and must prove that a restored system can resume sending without duplicating any message already accepted by Meta. Because the outbox key includes `attempt_key` and automatic retries reuse it, a replayed queue after restore conflicts rather than resends.

**AR-30** Because messaging limits and quality are pooled at the **business portfolio** level since 2025-10-07, all clients share one daily unique-recipient cap and one blast radius. The portfolio must be modelled as a first-class entity with its own live limit and utilisation, and every send decision must consult it. A WABA can never be migrated to another portfolio, so a client's number can never be handed over. New portfolios are capped at 2 phone numbers, rising to 20 after business verification. Templates live on the WABA, not on the sender number, so a template is usable by any sender number attached to its WABA.

**AR-31** No Meta App Review, Embedded Signup, Tech Provider or Solution Partner onboarding is required for v1, because CITS operates only its own assets inside its own already-verified portfolio using a business system user token. This removes an entire onboarding subsystem and its multi-week review dependency from v1 scope.

### 4.8 The pluggable send path

There are two send endpoints, not one. The standard Cloud API `/messages` endpoint is what v1 uses. The Marketing Messages API — `/marketing_messages`, commonly called MM Lite — is a separate endpoint for marketing templates that adds delivery optimisation, richer media, time-to-live and click reporting.

This matters for one reason: **max-price bidding for marketing requires MM Lite.** Sending a template that has a max price set to the Cloud API `/messages` endpoint is rejected by Meta with explicit guidance to use `/marketing_messages` instead. Max-price bidding is scheduled to become **required in eligible geographies in Q2 2027**. If India is in scope, every marketing send must move to the other endpoint before then.

**AR-32** The sending layer must be built from v1 behind a send-path abstraction with a single interface — build payload, send, interpret response, map errors — with the Cloud API as the only implementation shipped in v1 and the Marketing Messages path as a documented, unimplemented second implementation.

**AR-33** The campaign record must carry a `send_path` field from the **first database migration**, defaulting to the Cloud API value. Adding it later would require backfilling live campaign history.

**AR-34** Nothing outside the send-path implementation may hard-code the Cloud API endpoint, its request shape or its response shape.

**AR-35** MM Lite onboarding is a manual, per-WABA action performed in Business Manager (Quickstart, then accepting the Marketing Messages API Terms of Service). The system must record MM Lite onboarding state per WABA and must refuse to route a send down the marketing path for a WABA not marked as onboarded.

**AR-36** Because the error classification table is keyed on `(api_surface, code)`, adding a second send path adds a second API surface to that table rather than editing the existing rows. No code may be reclassified globally when the marketing path ships.

**[Verify before build]** Whether India is in the Q2 2027 "eligible geographies" list, and the exact bidding request field (`optimization_spec` superseded `bid_spec`, with `bid_spec` support ending 2026-07-31) — confirm against Meta's live marketing-messages pricing documentation before implementing the second send path.

---

## 5. Multi-client management

### 5.1 The workspace concept

Every client CITS serves is represented by exactly one **workspace** (used interchangeably with "client" and "tenant" in this document). A workspace is the boundary for data, permissions, sending, reporting and cost attribution.

**CL-1.** The system must model every domain object — contacts, contact groups, saved segments, tags, imports, consent records, templates, campaigns, messages, conversations, click events, usage records, audit entries, settings — with a non-nullable `workspace_id` foreign key. There must be no domain table that is global-by-default except reference data that contains no client information (country dialling codes, Meta error-code definitions, template category definitions).

**CL-2.** CITS's own communication (its newsletters, its own client announcements) must be sent from an ordinary workspace named "Cyberlative IT Solutions". The system must never special-case this workspace in code. Anything CITS can do for itself, it can do for a client, and vice versa.

**CL-3.** WhatsApp sender numbers are attached to a workspace, one dedicated number per client (see §7). Because CITS owns the business portfolio, the system must display, on the client profile screen and the master dashboard, a standing notice of two consequences of that ownership model: (a) since 2025-10-07 Meta calculates messaging limits and quality at the **business portfolio** level, so every CITS client shares one daily unique-recipient cap and one blast radius — one client's poor-quality sending degrades everyone; and (b) a WABA can **never** be migrated to another business portfolio, so a client's number and message history can never be handed over to that client. New portfolios are capped at 2 phone numbers, rising to 20 after business verification; CITS's portfolio is already verified. These are Meta platform rules, not CITS policy, and the client has accepted them.

**CL-3a.** Templates are owned by a client and live on that client's WhatsApp Business Account, not on a sender number. A template is usable by any sender number attached to that WABA. The 250/6,000 template ceiling and the template name-uniqueness rule are per WABA per language. The workspace screens must therefore present templates as a property of the client's WABA, never as a property of a phone number.

### 5.2 Client profile fields

| Field | Type | Required | Rules |
|---|---|---|---|
| Name | Text, 2–120 chars | Yes | Unique (case-insensitive) across active workspaces |
| Slug / short code | Text, 3–20 chars | Yes | Lowercase letters, digits, hyphens. Immutable after creation. Used in URLs, export filenames, click-tracking paths and log lines |
| Client type | Enum | Yes | Company · Society · Journal · Conference · University · Association · Research organization · Other |
| Website | URL | No | Must be `http://` or `https://`; stored normalised |
| Business email | Email | Yes | Single address; used for onboarding correspondence |
| Phone number | E.164 | Yes | Normalised with libphonenumber-js; default region IN. This is the client's own contact number, not their WhatsApp sender number |
| Address | Multi-line text + city, state, postal code, country | No (country: Yes) | Country as ISO-3166-1 alpha-2 |
| Primary contact person | Name (required), designation, email, phone | Yes | The human CITS talks to |
| Time zone | IANA identifier | Yes | Defaults to `Asia/Kolkata`. Drives campaign scheduling and report day boundaries |
| Default language | BCP-47 tag | Yes | Defaults to `en`. Used as the default template language |
| Logo | Image, PNG/JPG/SVG, ≤ 512 KB | No | Displayed in the workspace header only; never sent to Meta |
| Status | Enum | Yes | Exactly one of `onboarding` · `active` · `paused` · `suspended` · `archived`. See §5.3. Defaults to `onboarding` |
| Onboarding state | Enum | Yes | Not started · Number provisioning · Display name pending · Templates pending · Ready |
| Assigned CITS account manager | User reference | Yes | Must be a user holding Super Admin |
| Notes | Rich text, ≤ 10,000 chars | No | Internal only; never visible to client-side users |

**CL-4.** The system must reject a workspace creation or edit that fails any rule above, with a per-field error message. Slug immutability must be enforced server-side, not only in the form.

### 5.3 Client status lifecycle

The client status enum has exactly five values.

| Status | Meaning | What it permits |
|---|---|---|
| `onboarding` | Created, not yet sending | Configuration, contact import, template drafting. Campaign launch blocked |
| `active` | Normal operation | Everything |
| `paused` | Temporary halt at client or CITS request | Inbox and inbound work normally; no new campaign may be launched; scheduled campaigns do not fire |
| `suspended` | Non-payment, policy concern, or CITS decision | Outbound sending fully blocked; inbound still received and stored; workspace read-only to client-side users |
| `archived` | Relationship ended | Read-only to everyone; excluded from dashboards and quota planning by default |

**CL-5.** When a workspace moves to `paused` or `suspended`, the system must immediately (a) refuse to enqueue new sends, (b) leave every scheduled campaign for that workspace in state `scheduled` — it is neither deleted nor moved to any other state, and there is no `halted` or `blocked_by_client_status` state — and refuse it at pre-flight when its scheduled time arrives, recording the refusal reason "client status is paused/suspended" on the campaign and in the audit log, and (c) cancel queued-but-unsent jobs for in-flight campaigns while preserving already-sent message records. The campaign list must show these campaigns as scheduled with a visible "will not send: client `paused`/`suspended`" annotation.

**CL-6.** The system must never stop accepting inbound webhooks for a `suspended` or `archived` workspace. Inbound messages, status callbacks and `user_preferences` events must continue to be received, verified and stored, because opt-out and quality signals must never be lost. Inbound messages for a suspended workspace must be visible in the inbox to CITS users and flagged "workspace suspended — replies disabled".

**CL-7.** Restoring a workspace from `paused` or `suspended` to `active` must not auto-resume campaigns that were refused at pre-flight. A user must re-confirm each one, because its scheduled time has probably passed and its recipient list may be stale.

**CL-8.** Archiving must be reversible. Permanent deletion of a workspace is a separate, Super-Admin-only, re-authenticated action (see RP-11) and must be a soft delete with a 30-day recovery window before purge.

### 5.4 Tenant isolation — acceptance criterion, not a feature

**CL-9.** Tenant isolation must be enforced **in the database**, by one of: PostgreSQL row-level security policies keyed on a session-scoped tenant setting, or a mandatory tenant-scoped query helper through which all application queries pass and which cannot be bypassed. Scoping that exists only as a hand-written workspace filter at each call site is a **hard fail** and must not pass code review.

**CL-10.** The coding standards must ban raw string interpolation of any user-supplied or request-derived value into Drizzle `sql` template literals or any other SQL string. Drizzle must be pinned at `>=0.45.2`; earlier versions carry a known SQL-injection vulnerability in identifier handling.

**CL-11.** A cross-tenant isolation test suite must exist and must run in continuous integration on every commit. It must, for **every** API route, authenticate as a user belonging to workspace A and attempt to read, list, update and delete objects belonging to workspace B — by direct object ID, by list filter tampering, by query parameter, and by request body field. Every attempt must fail with 403 or 404, and no response body may leak the existence or any attribute of workspace B's data. A new API route without a corresponding isolation test must fail the build.

**CL-12.** Background workers, queue consumers, webhook handlers, scheduled jobs and export routines are in scope for CL-9 through CL-11. A job payload must carry `workspace_id` and the worker must set the tenant scope before touching data.

### 5.5 Master dashboard versus workspace view

**CL-13.** The system must provide a CITS master dashboard, visible only to Super Admins, showing across all workspaces: portfolio-level messaging limit and headroom used today, per-client message volume and estimated cost, quality rating per sender number, template approval and pause states, non-delivery counts broken down by error class, and workspace status. This is the only place where data from multiple workspaces appears together, and it must aggregate through the same tenant-scoped layer rather than bypassing it.

**CL-14.** Entering a client workspace as a Super Admin must be an explicit, logged action ("open workspace"), and the interface must display a persistent banner naming the workspace and stating that the user is acting as CITS staff.

**CL-15.** Every action a Super Admin takes inside a client workspace must be attributed in the audit log to that individual person, by user ID and name. The system must never record such an action as performed by "the client", by the workspace, or by a generic system account. Audit log format and retention are covered in §18.

---

## 6. Users, roles and permissions

### 6.1 The five roles

There are exactly five roles. **Super Admin** is an application-level role held on the user record, not per workspace. **Client Admin**, **Campaign Manager**, **Inbox Agent** and **Viewer** are assigned per workspace. No other role names exist anywhere in the product, the data model or the interface.

**Super Admin** (`super_admin`) — CITS staff. Scope: all workspaces plus the master dashboard. Can create, edit, suspend and archive clients; provision WhatsApp numbers; manage users; approve campaigns; view usage and cost across all clients; view every audit log. Must not be able to send a message without it being attributed to them personally (CL-15), and must not be able to disable or edit audit logging.

**Client Admin** (`client_admin`) — the client's own senior user, or the CITS account manager acting for them. Scope: one workspace. Can manage that workspace's users, contacts, templates, campaigns, inbox and reports, approve campaigns in that workspace, and view that workspace's usage and cost. Must not see any other workspace, must not view or rotate WhatsApp access tokens, must not add or remove WhatsApp sender numbers, and must not change client status or billing configuration.

**Campaign Manager** (`campaign_manager`) — scope: one workspace. Can import contacts, manage contact groups, saved segments and tags, author templates, submit them to Meta, build campaigns, send test messages, launch, pause, resume and cancel campaigns, and view reports. Must not manage users, must not export contacts, must not change opt-out status, must not approve campaigns, and must not see cost data.

**Inbox Agent** (`inbox_agent`) — scope: one workspace. Can view and reply in the inbox, assign conversations, close and re-open conversations, and block a user. Must not create or launch campaigns, must not import or export contacts, must not author templates, and has **no report access of any kind**. Per-agent conversation and response-time metrics are not in v1.

**Viewer** (`viewer`) — scope: one workspace. Read-only on contacts, campaigns, templates, reports and inbox. Must not send anything, must not export anything, and must not change any record. Sees masked phone numbers unless separately granted "View full phone numbers".

**RP-0.** A CITS campaign operator is simply a user who holds **Campaign Manager** in several workspaces. There is no cross-workspace operator role, and the system must not offer one. Access to more clients is expressed only as more per-workspace role assignments on the same user account.

### 6.2 Permission matrix

Y = yes · N = no · C = conditional (footnoted).

| Action | Super Admin | Client Admin | Campaign Manager | Inbox Agent | Viewer |
|---|---|---|---|---|---|
| Create client | Y | N | N | N | N |
| Edit client | Y | C¹ | N | N | N |
| Add WhatsApp number | Y | N | N | N | N |
| View access token | C² | N | N | N | N |
| Import contacts | Y | Y | Y | N | N |
| Undo an import | Y | Y | C¹¹ | N | N |
| Export contacts | C³ | C³ | N | N | N |
| Delete a contact | Y | Y | N | N | N |
| Merge contacts | Y | Y | Y | N | N |
| Archive a contact | Y | Y | Y | N | N |
| Manage contact groups and tags | Y | Y | Y | N | N |
| Manage saved segments | Y | Y | Y | N | N |
| Manage quick replies | Y | Y | Y | N | N |
| View full phone numbers | Y | Y | Y | C¹² | C¹² |
| Create template | Y | Y | Y | N | N |
| Submit template to Meta | Y | Y | Y | N | N |
| Edit a template after approval | Y | Y | C¹³ | N | N |
| Create campaign | Y | Y | Y | N | N |
| Send test message | Y | Y | Y | N | N |
| Launch campaign | Y | Y | C⁴ | N | N |
| Approve a campaign | C⁵ | C⁵ | N | N | N |
| Pause/resume/cancel campaign | Y | Y | Y | N | N |
| View inbox | Y | Y | Y | Y | Y |
| Reply in inbox | Y | Y | Y | Y | N |
| Assign conversation | Y | Y | Y | Y | N |
| Close / re-open conversation | Y | Y | Y | Y | N |
| Block a user | Y | Y | Y | Y | N |
| Change opt-out status | Y | C⁶ | C⁶ | N | N |
| View reports | Y | Y | Y | N | Y |
| Export a report | Y | Y | Y | N | N |
| View usage and cost | Y | C⁷ | N | N | N |
| Manage users | Y | C⁸ | N | N | N |
| View audit log | Y | C⁹ | N | N | N |
| Change settings | Y | C¹⁰ | N | N | N |

¹ All profile fields except slug, status, sender numbers and billing configuration.
² Requires re-authentication; the token is revealed once, masked otherwise, and the reveal is audited.
³ Requires re-authentication and a stated reason; every export is audited (see §19).
⁴ A Campaign Manager may launch on their own authority below the **campaign approval threshold**. At or above that threshold the campaign enters `pending_approval` on submit and can only proceed once approved (see §6.6). Above the **typed-confirmation threshold** the launch additionally requires typing the campaign name. Both thresholds are CITS product policy, not Meta rules.
⁵ May approve a campaign in a workspace where they hold Client Admin (Super Admin: any workspace), but **never a campaign they themselves submitted for approval**.
⁶ Opting a contact *out* is permitted for any role that can edit contacts; opting a contact back **in** requires a Client Admin plus documented consent evidence (see §10).
⁷ Own workspace only.
⁸ Own workspace only, and cannot grant Super Admin.
⁹ Own workspace only.
¹⁰ Workspace settings only — default language, notification recipients, the two campaign thresholds, the CITS-side frequency governor ceiling; not platform or portfolio settings.
¹¹ Only an import they themselves performed, and only within the 24-hour undo window (see §9). Undo deletes only contacts *created* by that import which have not since been messaged or replied; it never reverses an opt-out and never reverts updates to pre-existing contacts, and it is audit-logged.
¹² Off by default for Inbox Agent and Viewer. "View full phone numbers" is a distinct, separately grantable permission; without it the user sees only the last four digits (for example `•••• ••••1234`) in contact lists, contact detail, campaign reports, click reports and the inbox, and any export available to them carries the masked form. Granting it is audit-logged.
¹³ May edit and re-submit; the previously approved version continues to be the one the sending engine may release until the new version is itself `APPROVED` for the language being sent.

**RP-1.** The system must evaluate permissions server-side on every request. Hiding a button in the interface is presentation, never enforcement. Phone-number masking under footnote ¹² must likewise be applied server-side, so that an unmasked number never reaches the client for a user lacking the permission.

### 6.3 User-to-workspace assignment

**RP-2.** A user account must be able to belong to one or many workspaces, with exactly one role per workspace. A person may be Campaign Manager in one society and Viewer in another; a person holding Campaign Manager in many workspaces is what CITS calls a campaign operator (RP-0).

**RP-3.** Every request that touches workspace data must resolve the acting user's role **for that workspace**. A role held in workspace A must never grant anything in workspace B.

**RP-4.** Super Admin is an application-level role held on the user record, outside any workspace, and must be assignable only by another Super Admin. There must be at least one active Super Admin at all times; the system must refuse the action that would remove the last one.

### 6.4 Authentication

**RP-5.** Passwords must be at least 12 characters, checked against a compromised-password list at set time, hashed with the algorithm Better Auth provides by default, and never logged, emailed or displayed.

**RP-6.** Sessions must expire after 12 hours of inactivity and 7 days absolute. Session cookies must be `HttpOnly`, `Secure` and `SameSite=Lax`. A user must be able to view and revoke their active sessions; a Super Admin must be able to revoke any user's sessions.

**RP-7.** Two-factor authentication (TOTP) must be mandatory for every Super Admin and every Client Admin. The system must block access to privileged screens until enrolment is complete. It must be optional but available for all other roles. Recovery codes must be issued once at enrolment.

**RP-8.** Users must be created only by invitation. An invitation carries a target workspace and role, expires after 7 days, is single-use, and must be revocable before acceptance.

**RP-9.** Users are deactivated, never hard-deleted, so that audit history and message attribution remain intact. Deactivation must immediately revoke all sessions and invitations for that user.

**RP-10.** When a user is deactivated, every `open` conversation assigned to them must be automatically returned to the workspace's unassigned queue, and a notification must be sent to the workspace's Client Admins listing the reassigned conversations. Conversations must never be left assigned to an inactive user.

### 6.5 Dangerous actions

**RP-11.** The following actions must require a step-up: either password re-entry plus second factor within the last 5 minutes, or an explicit typed confirmation naming the object. Each must be written to the audit log with actor, workspace, timestamp and parameters.

| Action | Requirement |
|---|---|
| Launching a campaign above the typed-confirmation threshold | Typing the campaign name |
| Launching a campaign at or above the campaign approval threshold | Typing the campaign name **and** a recorded approval by a Client Admin or Super Admin (§6.6) |
| Exporting contacts | Re-authentication + stated reason |
| Re-opting-in a contact | Re-authentication + consent evidence reference |
| Revealing or rotating a WhatsApp access token | Re-authentication, Super Admin only |
| Deleting (not archiving) a client workspace | Re-authentication + typing the workspace slug, Super Admin only |
| Requesting the eighth registration or deregistration attempt on a number within the rolling 72-hour window | Explicit typed operator confirmation (see §7) |

**RP-12.** There are two separate, separately named recipient thresholds. Both are per-workspace settings with platform-wide defaults, and both are CITS product policy — Meta publishes no such thresholds.

| Setting | Default | Effect |
|---|---|---|
| **typed-confirmation threshold** | 500 recipients | Above it, launch requires typing the campaign name |
| **campaign approval threshold** | 1,000 recipients | At or above it, launch additionally requires approval by a Client Admin or Super Admin |

The system must refuse to save a campaign approval threshold lower than that workspace's typed-confirmation threshold, with a per-field error, and must re-validate the pair whenever either value is edited.

### 6.6 Campaign approval workflow — the permission side

**RP-13.** A campaign whose final recipient count is at or above the workspace's campaign approval threshold must enter state `pending_approval` when submitted, and may move to `scheduled` or `running` only after an approval decision is recorded. Any user who may launch a campaign in that workspace — Super Admin, Client Admin, Campaign Manager — may submit it and thereby request approval.

**RP-14.** Only a Client Admin of that workspace or a Super Admin may approve or reject a `pending_approval` campaign. A user must never be able to approve a campaign they themselves submitted for approval, regardless of role; the system must refuse the action server-side rather than merely hiding the control. Where a workspace has only one Client Admin and that person submitted the campaign, approval must be sought from a Super Admin.

**RP-15.** The campaign record must carry approval-requested-by, approval-requested-at, approved-by, approved-at and an approval-note. A rejection returns the campaign to `draft` with the note preserved and shown to the submitter.

**RP-16.** Both the request and the decision must raise notifications — the request to every Client Admin of the workspace and to the assigned CITS account manager, the decision to the submitter — and both must be written to the audit log with actor, workspace, campaign, recipient count, threshold value in force at the time, and the note.

**RP-17.** If the recipient count changes after approval such that the campaign now targets more recipients than the approved figure, the approval is void and the campaign returns to `pending_approval`. A decrease does not void the approval.

### 6.7 What this means for the build

Better Auth's Organization plugin supplies organisations, members, teams and invitations; its Admin plugin supplies application-level roles. Workspaces map to organisations, the four per-workspace roles map to organisation member roles, Super Admin maps to an Admin-plugin role, and the invitation flow in RP-8 is provided rather than written. Most of §6 is therefore configuration — role definitions, permission checks, the step-up rules in RP-11, the masking rule in footnote ¹² and the approval rules in §6.6 — not new authentication code. Do not build a bespoke session or JWT layer. **[Verify before build]** Confirm that the Organization plugin's invitation expiry and session-revocation behaviour match RP-6, RP-8 and RP-9 in the pinned version before assuming they are free.

---

## 7. WhatsApp sender numbers

### 7.1 The Meta object hierarchy, in plain English

Three nested objects sit between CITS and a message on a recipient's phone.

| Level | What it is | What attaches here |
|---|---|---|
| **Business portfolio** (formerly "Business Manager account") | The top-level Meta business entity. CITS has exactly one, already business-verified. | **Messaging limits** (unique recipients per rolling 24 hours), quality and enforcement, volume-tier aggregation for utility and authentication pricing, portfolio pacing, and the phone-number cap (2 for a new portfolio, 20 after verification). |
| **WhatsApp Business Account (WABA)** | A container inside a portfolio that holds phone numbers and templates. | Message templates (250 per WABA per language if the portfolio is unverified, up to 6,000 if verified with an approved display name — see §11 Templates), webhook subscriptions, Graph API request-rate limits (200 requests/hour for an inactive WABA, 5,000 for an active one — **[Verify before build]**). |
| **Business phone number** | The actual sender number, carrying a display name. | Throughput (messages per second), quality rating (GREEN/YELLOW/RED), display-name status, registration state, data localization region. |

Templates are owned by the WABA, not by the sender number: a template belongs to one client, lives on exactly one WABA, and is usable by any sender number attached to that WABA (see §11 Templates).

Two consequences of the CITS-owns-everything model must be stated on the sender-numbers screen itself, not buried in documentation:

- **Since 2025-10-07 messaging limits are calculated and set at the business portfolio level and shared by every phone number in the portfolio.** All CITS clients draw on one daily unique-recipient allowance from the same ladder (250 → 2,000 → 10,000 → 100,000 → Unlimited), and one client's poor conduct is one blast radius for everyone. A new number inherits the portfolio's current tier rather than starting at 250.
- **A WABA belongs to exactly one portfolio, cannot be co-owned, and can never be migrated.** A client's number can therefore never be handed over to that client. This is a one-way door the client has accepted; the product must not imply otherwise anywhere in the interface.

**SN-1.** The sender numbers list must display the portfolio-level messaging limit tier and today's utilisation against it as a single shared figure, read from the business portfolio record at render time, labelled as shared across all clients, on every screen where a per-number limit might otherwise be inferred.

**SN-2.** The system must never present a "transfer number to client" or "export WABA" action, and the number detail screen must carry a permanent notice that the WABA cannot be migrated.

### 7.2 Fields stored per sender number

One row per client-facing number. Meta-sourced fields are cached locally and refreshed on a schedule and on webhook events; every cached field carries its own last-refreshed timestamp so stale data is visibly stale rather than silently wrong.

| Field | Source | Notes |
|---|---|---|
| Client | CITS | Exactly one client per number (see §5 Multi-client management). |
| WhatsApp display name | CITS, then Meta | The name recipients see. |
| Sender phone number | CITS | Stored in E.164 form. |
| Meta phone number ID | Meta | The identifier used in every send and register call. |
| WhatsApp Business Account ID | Meta | Parent WABA. |
| Business portfolio ID | Meta | Same value for all rows in v1; kept as a field so a second portfolio is a data change, not a migration. |
| Default language | CITS | Default template language for this client's sends. |
| Status | Meta | Connected or Restricted (see §7.8). |
| Notes | CITS | Free text for the operator. |
| Quality rating | Meta | GREEN / YELLOW / RED, plus local history. |
| Messaging limit tier last-refreshed timestamp | CITS | **The tier value itself is never stored on the sender number.** The messaging limit lives on the business portfolio record and is read from there at render time; the sender number stores only when that portfolio value was last refreshed on this number's behalf. |
| Current throughput | Meta | Messages per second. |
| Display-name approval status | Meta | One of APPROVED, AVAILABLE_WITHOUT_REVIEW, DECLINED, PENDING_REVIEW, EXPIRED, NONE. |
| Data localization region | Meta | ISO-2 code; IN for India-facing numbers. |
| Registration attempt counter | CITS | Count of registration attempts in the rolling 72-hour window (see §7.4). |
| Deregistration attempt counter | CITS | Count of deregistration attempts in the rolling 72-hour window — an independent counter (see §7.4). |
| Last refreshed, per Meta-sourced field | CITS | Timestamp shown in the UI beside each value. |

**SN-3.** The system must store all fields above and must display, for every Meta-sourced field, when it was last refreshed. A value older than 24 hours must be visually marked as stale. The messaging limit tier shown on a number's detail screen must be rendered by reading the portfolio record, with the number's stored last-refresh timestamp shown beside it.

### 7.3 The dual-use warning

A phone number registered on the Cloud API **cannot be used in the ordinary consumer WhatsApp app**. Meta's rule is blunt: numbers already in use with WhatsApp cannot be registered unless they are deleted from WhatsApp first. If a client hands over a number that a staff member uses daily on their phone, that use ends.

There is exactly one exception, called **coexistence**: a number running the **WhatsApp Business app** (not consumer WhatsApp) can run on the app and the Cloud API at the same time. It costs real capability:

- Throughput is fixed at **20 messages per second** instead of the default 80.
- Group chats, disappearing messages, view-once messages, live location, broadcast lists and catalogs are **disabled**.
- Companion clients are unlinked.
- Message history must sync within **24 hours** or onboarding restarts from the beginning.
- It requires a customised Embedded Signup flow and Solution Partner or Tech Provider status, plus three extra webhook subscriptions (`history`, `smb_app_state_sync`, `smb_message_echoes`).

**v1 does not support coexistence.** It requires Embedded Signup and Tech Provider onboarding, which v1 explicitly avoids (see §2 Platform constraints), and its capability losses are severe. Clients must supply a number that no one needs to use in a phone app.

**SN-4.** The add-number screen must display the dual-use warning as a blocking acknowledgement — the operator must tick a confirmation that the number is not in active use in any WhatsApp app — before the number can be submitted.

**SN-5.** The system must not offer coexistence onboarding in v1, and must state on-screen that a coexistence number would be capped at 20 messages per second and lose group chats, disappearing messages, view-once, live location, broadcast lists and catalogs.

### 7.4 Onboarding runbook for a new client number

A numbered checklist the solo developer follows once per client. Steps 1–3 happen in Meta's WhatsApp Manager; steps 4–7 are API calls the product makes. Adding, registering and deregistering a sender number is restricted to Super Admin.

1. **Create or select the WABA** inside the CITS portfolio. Reuse an existing WABA unless template count or organisational clarity argues otherwise.
2. **Add the phone number** to the WABA and complete Meta's ownership verification (SMS or voice call to that number).
3. **Get the display name approved.** Record the resulting `name_status`. Only APPROVED and AVAILABLE_WITHOUT_REVIEW permit normal operation; DECLINED, PENDING_REVIEW, EXPIRED and NONE must block campaign sending on that number. Sending with an unapproved display name surfaces as error 131037.
4. **Register the number** with `POST /<PHONE_NUMBER_ID>/register`, body `{"messaging_product":"whatsapp","pin":"<6 digits>"}`. **The PIN is required unconditionally.** If two-step verification is not already enabled on the number, the value supplied *becomes* the number's two-step verification PIN — so it must be generated, recorded in the encrypted secret store, and never shown twice.
5. **Set the data localization region** to `IN` for India-facing numbers by including `"data_localization_region":"IN"` in the same register call. `IN` (India) and `BR` (Brazil) are confirmed valid values. The wider list of valid values — AU, ID, JP, SG, KR, DE, CH, GB, BH, ZA, AE, CA — is **[Verify before build]**. **Changing this later requires deregistering and re-registering**, which consumes one attempt from each of the two counters in SN-7.
6. **Subscribe the app to the WABA's webhooks** with `POST /<WABA_ID>/subscribed_apps`, then confirm the subscription list reads back the expected fields (§7.7).
7. **Send a test message** to a nominated internal number and confirm a `sent` and then `delivered` status webhook arrives (§7.5).

The trap that will bite hardest: **registration and deregistration are two independent counters, each capped by Meta at 10 requests per number per 72-hour moving window.** They are not one shared pool of ten. Exceeding either cap returns **error 133016** and locks the number for three days. An automatic retry loop in the onboarding code would take a client offline for 72 hours before anyone noticed.

**SN-6.** The onboarding checklist must be implemented as an explicit stateful wizard, with each of the seven steps individually marked complete or failed, resumable after a failure, and never restarting from step 1 automatically.

**SN-7.** The system must maintain, per number, **the registration-attempt counter and the deregistration-attempt counter, each against its independent cap of 10 per rolling 72 hours**. For either counter, the system must refuse to issue the **eighth** attempt without an explicit typed confirmation from an operator, and must refuse the **eleventh** attempt unconditionally. It must never retry a registration or deregistration call automatically. The cap of 10 per counter per 72 hours is Meta's rule; the typed-confirmation gate at the eighth attempt is CITS product policy, set below Meta's cap to leave headroom.

**SN-8.** On receiving error 133016, the system must record a lock expiring 72 hours later, disable the register and deregister buttons for that number until then, show the exact unlock time, and raise an operational alert (see §18 Audit logs and notifications).

**SN-9.** The system must warn, before any change to data localization region, that the change requires deregistration and re-registration and therefore consumes **one attempt from the deregistration counter and one from the registration counter**, and must show the current value of both counters and their window expiry times before the operator confirms.

### 7.5 Test message tool

The primary diagnostic when a client's number misbehaves. From the number detail screen, an operator picks a nominated internal test number, chooses either an approved template or a free-form message, and sends. The tool is available to Super Admin and to Client Admin on that client's own numbers.

**SN-10.** The test-message tool must display the full outbound request (endpoint, headers with the token redacted, and JSON body) and the full response body including the returned `message_status` value, which is one of `accepted`, `held_for_quality_assessment` or `paused`.

**SN-11.** The tool must then show every status webhook received for that message, in timestamp order, with the raw payload available on expand, and must state plainly that HTTP 200 means accepted, not delivered.

**SN-12.** Free-form test messages must be blocked with an explanatory message when no customer service window is open with the test number, because free-form sends outside the window fail with error 131047 on `/messages` (see §13 Sending engine; note that 131047 means something different on `/block_users`, which is why the error classification table is keyed on API surface and code together).

**SN-13.** Test messages must be recorded in usage tracking and attributed to the client whose number sent them (see §17 Usage and cost tracking).

### 7.6 Access token management

One business system user token per client number. Meta does not document whether these tokens expire, so the design assumes they can.

**SN-14.** The system must store one access token per sender number in a variable-length column, envelope-encrypted at rest. Tokens are opaque strings of variable length — the system must never parse, truncate, validate the shape of, or infer anything from a token's contents.

**SN-15.** A token must never be sent to the browser, never appear in logs, never appear in Sentry events, and never appear in the test-message request viewer (SN-10 redacts it).

**SN-16.** CITS must use **employee** system users granted access to specific WABAs, not admin system users. Admin system users receive access to every WABA owned by or shared with the portfolio by default; employee system users are granted per-WABA and are the least-privilege choice.

**SN-17.** The system must run a token health check per number **every 6 hours** by making a low-cost read call (for example `GET /<PHONE_NUMBER_ID>?fields=throughput`) and recording success or the returned error code.

**SN-18.** On a token failure — error 190, 0 or 200 — the system must mark the number's token as failed, pause all queued sends for that number, show a red banner on the number detail and client dashboard reading "Access token invalid — sending paused," provide a guided re-authentication flow that replaces the stored token, and raise an operational alert. It must never retry sends on a failed token.

**SN-19.** The system must support replacing a token without downtime for other numbers, and must record every token creation, replacement and revocation in the audit log with the actor and timestamp, but never the token value. Token replacement is restricted to Super Admin.

### 7.7 Webhook subscriptions and the number health page

Subscribe each WABA to the following fields. Note that `messages` requires the `whatsapp_business_messaging` permission; everything else requires `whatsapp_business_management`.

| Webhook field | What it tells you |
|---|---|
| `phone_number_quality_update` | Quality rating changes, and **also throughput changes** (events include `ONBOARDING` and `THROUGHPUT_UPGRADE`). The `current_limit` and `old_limit` payload fields are **deprecated** — read `max_daily_conversations_per_business` instead. |
| `account_update` | Account-level changes including policy violations and restrictions, with restriction duration. The real-time source of enforcement news. |
| `business_capability_update` | Changes to the portfolio's messaging limit tier and related capabilities. This is the event that updates the portfolio record the numbers screens read from. |
| `account_alerts` | Meta-issued alerts on the account. |
| `message_template_quality_update` | Per-template quality change, carrying `previous_quality_score` and `new_quality_score`. |
| `message_template_status_update` | Template approved, rejected, paused, disabled, pending deletion or flagged. |
| `template_category_update` | Category reclassification, carrying `previous_category`, `new_category` and `correct_category`. |
| `user_preferences` | A recipient used WhatsApp's native "Offers and announcements" control to stop or resume marketing. Once stopped, Meta accepts the send request and silently does not deliver — this must be honoured as a hard suppression (see §10 Consent and opt-out). |

**SN-20.** The system must subscribe every WABA to all eight fields above plus `messages`, must verify the subscription by reading back the subscribed apps list after step 6 of the runbook, and must alert if a subscription is later found missing.

**SN-21.** The number health page must show: current quality rating with a history chart of at least 30 days; the current portfolio messaging limit tier with today's unique-recipient utilisation against it, read from the portfolio record and explicitly labelled as shared across all clients; current throughput in messages per second; a histogram of failure codes over the last 7 days, keyed on (API surface, code), with counts and plain-English descriptions; and any active restriction with its stated end time. Any rate on this page whose numerator was never captured inside Meta's 7-day analytics window must render as **"not captured"**, never as zero.

**SN-22.** Quality rating is computed by Meta from the last 7 days of user feedback — blocks, reports, mutes, archives, and the reasons users give when blocking — weighted to recency. **Meta publishes no thresholds and no algorithm.** Any warning threshold the product applies (for example, alerting when a number moves from GREEN to YELLOW, or when the 7-day failure rate exceeds a set percentage) is **CITS product policy** and the UI must label it as such. Failure rate here means failed ÷ final recipients; messages blocked by the per-user marketing frequency cap (error 131049 on `/messages`), messages blocked by the CITS-side frequency governor, and messages dropped by Meta's pacing must never be summed into it (see §15 Reporting).

Note that since 2025-10-07 the "Flagged" phone-number state no longer exists, and a quality drop no longer downgrades the messaging limit. Quality now bites through template pacing, template pausing and policy enforcement instead (see §11 Templates and §13 Sending engine).

### 7.8 Number states

Two states matter operationally.

- **Connected** — the number can send business-initiated messages normally.
- **Restricted** — the number has hit its 24-hour business-initiated messaging limit. Inbound messages and replies inside an open customer service window still work.

**SN-23.** While a number is Restricted, the system must refuse to dispatch any business-initiated message from it, must hold rather than fail queued campaign sends, must display the restriction and its end time on the client dashboard, and must continue to accept and display inbound messages in the inbox. A campaign whose sends are held this way remains in its existing state — `scheduled` or `running` — and is refused at pre-flight where applicable; there is no separate halted state.

**SN-24.** The system must never automatically switch a client's traffic to a different client's number for any reason.

### 7.9 Mobile behaviour

**SN-25.** The sender numbers list and the number health page are **mobile-usable**: readable and navigable at 375px width, with editing (add number, register, deregister, region change, token replacement) deferred to a larger screen. The onboarding wizard (§7.4) and the test message tool (§7.5) are **desktop-first**: at 375px they degrade to a legible read-only view plus a "best used on a larger screen" notice, never a broken layout.

### 7.10 [Verify before build]

| Item | What the fact base says | Action |
|---|---|---|
| Enabling data localization on an already-registered number | Meta documents that *changing* the region requires deregister plus re-register; whether it can be *enabled* on a number registered without it is not separately documented. | Test on a throwaway number before onboarding the first client, because getting it wrong costs one attempt from the deregistration counter and one from the registration counter. |
| Valid `data_localization_region` country list | Only `IN` (India) and `BR` (Brazil) are primary-confirmed. The wider list — AU, ID, JP, SG, KR, DE, CH, GB, BH, ZA, AE, CA — is not confirmed against primary Meta documentation. | Confirm the full list against Meta's current documentation before building the region picker; ship v1 with `IN` and `BR` selectable and the rest gated behind confirmation. |
| Per-WABA phone number cap | Not documented. The portfolio cap (2 new, 20 after verification) is documented; the per-WABA cap is not. | Plan on "up to 20, portfolio-wide" and confirm with Meta before adding a tenth number. |
| Whether business system user tokens expire | Not stated in Meta's documentation. | Design for refresh and re-authentication regardless — SN-17 and SN-18 assume expiry is possible. |
| Graph API request-rate limits per WABA | 200 requests/hour inactive, 5,000 active — not confirmed against primary documentation. | Confirm before setting worker concurrency (see §13 Sending engine). |

---

## 8. Contacts, groups and tags

### 8.1 What a contact is

A contact is one person, held inside exactly one client workspace. Two workspaces may each hold the same human being; those are two separate contact records with separate consent, because consent was given to a specific society or journal, not to CITS.

**CT-1.** The system must store every contact under exactly one workspace and must never expose a contact to any other workspace through search, segmentation, export or campaign targeting.

Fields fall into three groups.

| Group | Fields |
|---|---|
| Client-supplied | Full name, mobile number as supplied, email, member ID, designation, organization/institution, city, state, country, contact type, notes |
| System-derived | E.164 normalised phone number, country derived from the number, language preference, source, created at, updated at, last engagement at, deliverability state, workspace uniqueness key |
| Consent (owned by §10) | Consent status, consent source, consent captured at, opt-out status, opt-out captured at, opt-out reason |

**CT-2.** The system must store both the original number exactly as supplied and the normalised E.164 number, and must never overwrite the original. When a number fails to normalise, the original is what the user needs to see in order to fix it.

**CT-3.** "Country" must exist twice and mean two different things: the country the client typed into a spreadsheet (free text, may be wrong or blank) and the country derived from the E.164 number by the phone library. Campaign targeting and cost estimation must use the derived country, because Meta prices a delivered template by the recipient's country calling code (see §17).

**CT-4.** `last_engagement_at` must be updated whenever an inbound message, button tap or read receipt is received for that contact, and must be usable as a filter and sort key. It is the primary input to list hygiene.

**CT-5.** Contact type must be a per-workspace editable list, not a hardcoded enumeration. Seed every new workspace with: Member, Author, Reviewer, Editor, Delegate, Speaker, Committee Member, Lead, Client, Sponsor, Other. A Client Admin must be able to add, rename and retire types; retiring a type must never delete the contacts holding it.

**CT-6.** The per-workspace uniqueness key is the E.164 number. The system must never allow two active contacts with the same E.164 number in the same workspace. Email and member ID must not be unique — societies legitimately share a departmental email across members.

### 8.2 Phone numbers — the part that must not be got wrong

This is the highest-consequence detail in the whole product.

**CT-7.** Every number must be normalised to E.164 (a leading `+`, then country code, then subscriber number, digits only) at the moment it enters the system — on import, on manual creation, on API creation, on edit. The stored E.164 value is the only value ever sent to Meta.

**CT-8.** For Indian numbers the normaliser must: accept `+91` followed by a ten-digit mobile number; strip a single leading zero (`09876543210` → `+919876543210`); strip a duplicated country code (`+919198765...` where the remainder is already a valid ten-digit mobile); strip spaces, hyphens, brackets and non-breaking spaces; and reject anything that does not validate as a **mobile-capable** Indian number. Landlines must be rejected, not silently accepted.

**CT-9.** The system must always send the `to` value with a leading `+` and full country code. Meta's documented behaviour is that if the plus sign is omitted, the **sender's** country calling code is prepended to the recipient number. An India-registered sender given `6315551234` will deliver to `+916315551234` — a real, different Indian person. The message succeeds, is charged, and lands with a stranger. There is no recovery. Any code path that builds a recipient string without a leading `+` is a defect.

**CT-10.** Numbers that fail syntactic validation must be stored with the deliverability state `invalid` and an error reason, must be visible and fixable in the UI, and must never be enqueued for sending.

**CT-11 (default workspace setting).** Where a number is supplied without a country code and the workspace has a default country (India for most CITS clients), the system must apply that default, mark the contact `country_assumed = true`, and show that flag in list views. Assumed-country contacts must be excludable from campaigns with one filter.

### 8.3 You cannot check whether a number is on WhatsApp

There is no endpoint that answers this. The old `/contacts` endpoint was On-Premises only, and the On-Premises API's final client expired 2025-10-23; messages to numbers still on it are not delivered.

**CT-12.** The system must never call a third-party "is this number on WhatsApp" checker. These are unofficial, unsupported, and carry policy risk to a portfolio that all CITS clients share.

**CT-13.** Deliverability must be *learned* from send outcomes, not predicted. Every contact carries exactly one of four deliverability states:

| State | Meaning | How it is reached |
|---|---|---|
| `unknown` | Never sent to, or no outcome yet | Default on creation |
| `deliverable` | At least one `delivered` webhook | Delivery evidence |
| `suspect` | Repeated undeliverable outcomes meeting the strike rule (CT-15) | Delivery evidence only |
| `invalid` | Failed **syntactic** validation | Validation only |

**CT-13a.** `invalid` is reserved for syntactic validation failure only. Delivery evidence must never set `invalid`; the worst it can produce is `suspect`. A number that parses correctly but never delivers is `suspect`, not `invalid`, however many times it fails.

**CT-14.** Error **131026 ("message undeliverable") on the `/messages` surface must never move a contact to `suspect` on a single occurrence.** Meta's own documentation shows this code is overloaded: it also fires when the recipient's WhatsApp client is out of date, when the recipient has not accepted WhatsApp's terms, and when Meta declines the message on policy or quality grounds. A quality problem on our side can therefore look exactly like a dead number, and a naive implementation would delete a client's entire list in one bad campaign. The code is classified `PROBABLE_INVALID_CONTACT` on the key **(api_surface, code)** = (`/messages`, 131026) — see §13; it must never be interpreted on the code alone.

**CT-15.** A contact may only be marked `suspect` when it has accumulated at least **N** occurrences of 131026 across at least **M** distinct campaigns **and** at least **D** distinct calendar days. Defaults, which are **CITS product policy and not a Meta rule**, are **N=3, M=2, D=2**. All three must be configurable per workspace without a deploy. The transition is operator-reversible.

**CT-16.** `suspect` must be a soft state. Suspect contacts are excluded from campaigns by default but remain visible, exportable and re-includable with one click; a Campaign Manager, Client Admin or Super Admin may reset a contact to `unknown` at any time, and any subsequent `delivered` webhook must reset it to `deliverable` and clear the strike counters.

**CT-17.** If a single campaign produces 131026 for more than **20%** of its final recipients (CITS product policy threshold, configurable per workspace), the system must record **zero strikes for that campaign** — no contact touched by it accrues a strike — and must raise an `OPERATIONAL_ALERT` instead. An undeliverable proportion that high is a sender, template or quality problem, not a list problem.

**CT-17a (precedence over the batch circuit breaker).** The sending engine's batch failure-rate circuit breaker (§13) is evaluated first and independently. If it fires, it stops the campaign, and strike recording is then suppressed **for the whole campaign — every batch, including batches already completed before the breaker fired — not merely for the remaining batches.** Any strikes provisionally recorded earlier in that campaign must be rolled back. CT-17's own 20% rule is evaluated only on campaigns the circuit breaker did not stop. In no case may a campaign that was stopped by the breaker leave a single contact in `suspect`.

### 8.4 Duplicates and merging

**CT-18.** Two contacts in the same workspace are duplicates when their E.164 numbers match. Matching name plus email, or matching member ID, is a *possible* duplicate: the system must surface these as suggestions for human review and must never merge them automatically.

**CT-19.** Merging must let the user choose a surviving record and, field by field, which value wins. The merge must union group memberships, union tags, and carry over every consent and opt-out record, campaign send history, click events and conversation history onto the survivor.

**CT-20.** **If either record is opted out, the merged record is opted out.** Merging must never resurrect an opted-out contact as opted-in, regardless of which record the user chose as the survivor or which consent timestamp is newer. This rule has no override in the UI.

**CT-21.** Every merge must be reversible for 30 days: store the pre-merge snapshot of both records and offer an undo. After 30 days the snapshot is purged. Merges are audit-logged (§18).

### 8.5 Lists, search, bulk actions, deletion

**CT-22.** The contact list must support free-text search across name, phone (both forms), email, member ID and organization, plus filters on contact type, group, tag, consent status, opt-out status, deliverability state, derived country, state, city, language, source, created-date range and last-engagement-date range. Filters combine with AND across fields and OR within a field's selected values.

**CT-23.** Any filter combination must be savable as a named **saved segment** and reusable as a campaign audience. A saved segment is a stored filter definition, never a frozen list of contacts, and is resolved to contacts at the moment it is used — including at campaign send time. Saved segments are in v1.

**CT-24.** Bulk actions on a filtered selection: add to group, remove from group, add tag, remove tag, change contact type, set language, archive, export. Bulk *opt-in* must not exist — consent is never granted in bulk from a list view (see §10). Bulk opt-out must exist and must always be permitted.

**CT-25.** Export must produce CSV or Excel containing the same fields as import, plus consent status, opt-out status and deliverability state, and must be audit-logged with the exporting user, the row count and the filter used.

**CT-25a (Viewer phone masking).** "View full phone numbers" is a distinct permission, separate from the ability to see contacts at all. A user holding **Viewer** without that permission must see every phone number rendered masked — last 4 digits only, the preceding digits replaced by a fixed mask, for example `•••••• 4821` — in contact lists, contact detail, search results, campaign reports, click reports and the inbox. Search must still match on the full number so a Viewer who already knows a number can find it, but the number must never be rendered in full and must never appear in full in an export produced by that user: masked exports carry the masked value, and the export file is marked as masked. Granting the permission is a Client Admin or Super Admin action and is audit-logged. The rule applies identically on screen and in every generated file.

**CT-26.** Archiving is the default removal action: the contact is hidden from lists and excluded from all targeting, but retained with full history and restorable.

**CT-27.** Hard deletion (erasure) must write a **suppression entry keyed on the E.164 phone number** before the contact row is removed. Without this, the next import re-creates the contact as a fresh, un-opted-out record and the system messages a person who asked to be erased. The suppression entry stores the number, the workspace, the reason, and the timestamp — and nothing else identifying. This is the direct interaction between the right to erasure and the duty to honour opt-outs; see §10 Consent and opt-out and §20 Compliance.

**CT-28.** Deletion must be restricted to users holding **Client Admin** in the workspace, or **Super Admin**, and must always be audit-logged.

### 8.6 Groups and tags

**CT-29.** A **contact group** is a named collection with a description and an owner — a durable audience a client thinks of as a thing ("2027 Conference Delegates", "Editorial Board"). A **tag** is a free-form label with no description — a lightweight attribute ("paid-2026", "poster-track", "keynote-invited"). A contact belongs to many groups and carries many tags. Both are workspace-scoped.

Rule of thumb for the user, stated in the UI: use a group when you would send a campaign to it; use a tag when you would filter by it.

**CT-30.** Example groups to offer as one-click starters on workspace creation, editable and deletable: society members, conference delegates, journal authors, editorial board, executive committee, reviewers, abstract submitters, regional members, international members, renewal pending, leads, clients. These are examples, not a fixed taxonomy.

**CT-31 (groups versus saved segments).** These are two distinct entities and both are in v1.

| | Contact group | Saved segment |
|---|---|---|
| What it holds | Explicit, static membership — a list of contacts | A stored filter definition |
| When membership is decided | When a contact is added or removed | Resolved to contacts at the moment the segment is used |
| Type field | None. There is no `dynamic` type on a group | Not applicable |
| Editing | Add/remove contacts individually or in bulk | Edit the filter |

A contact group is static membership only; no `dynamic` group type exists on it in the data model or in any screen. Auto-updating audiences are expressed exclusively as saved segments (CT-23). The screens must reflect the same split as the data model: "Groups" and "Segments" are separate navigation items, a group's detail screen shows members and never a filter, and a segment's detail screen shows a filter and a live preview count and never a membership list.

**CT-32.** Deleting a group, tag or saved segment must never delete contacts. The system must show the affected contact count and require confirmation.

**CT-33.** Campaign audiences must be buildable from any combination of: groups, tags, contact types, derived country, state, saved segments, and an uploaded one-off list. Within one criterion type, multiple values combine with OR; across criterion types they combine with AND. Example: (Group = Members OR Group = Delegates) AND (Country = India) AND (Type = Reviewer).

**CT-34.** Every audience must support an **exclusion** set built the same way, applied after inclusion. Exclusions must be evaluated last and must be visible in the audience preview.

**CT-35.** The audience builder must show a live count and a breakdown before sending: total matched, minus opted-out, minus suppressed, minus invalid, minus suspect, minus blocked by the CITS frequency governor (CT-36), equals sendable. Each exclusion reason is itemised separately. Consent, suppression and frequency-governor filtering is unconditional and cannot be switched off in the builder.

### 8.7 CITS-side frequency governor

**CT-36.** The system must implement a **CITS-side frequency governor**: a configurable ceiling on how many marketing messages a single contact may receive in a rolling period. This is **CITS product policy**, entirely separate from and additional to Meta's own per-user marketing frequency cap. The two are enforced at different points and must never be conflated in code, in the UI or in reporting.

| | CITS frequency governor | Meta's per-user cap |
|---|---|---|
| Owner | CITS | Meta |
| Where enforced | Pre-send suppression check, before the message is released | By Meta, after the send is accepted |
| How it surfaces | Recipient excluded at pre-flight, counted under its own exclusion reason | Error 131049 on the send result |
| Configurable | Yes, per client and platform-wide | No |

**CT-37.** The governor is configured as a count and a rolling window, held at two levels: a **platform-wide default** and a **per-client override**. The suggested default is **4 marketing messages per contact per 30 days per client**. A per-client value may be set stricter or looser than the default by a Super Admin; a Client Admin may set it stricter than the platform default but not looser. Changes are audit-logged.

**CT-38.** The count is kept per contact per client workspace, counts only marketing-category template messages that were actually released to Meta, and does not count utility or authentication templates, service-window replies, or messages that were themselves excluded.

**CT-39.** Enforcement happens in the pre-send suppression check alongside opt-out and suppression, and the resulting exclusions must be surfaced in the pre-flight summary as their **own named exclusion reason** ("blocked by CITS frequency governor"), never merged into opted-out, suppressed or failed counts. Messages blocked by the governor never reach Meta and therefore never appear in the failure rate; they are excluded before the send, so they are not part of final recipients (see §17 for how non-delivery is composed).

**CT-40.** A campaign whose audience is materially reduced by the governor must say so plainly at pre-flight — how many recipients are being held back and when the earliest of them becomes eligible again — so the operator can reschedule rather than assume a list problem.

## 9. Contact import

### 9.1 Upload and mapping

**IM-1.** The system must accept `.xlsx` and `.csv` uploads, parsed with exceljs and papaparse respectively. The npm `xlsx` package must never be used (see §3).

**IM-2.** Limits, enforced server-side: maximum file size **10 MB**, maximum **20,000 rows** per file as a hard cap. Files exceeding either are rejected before parsing with a message telling the user to split the file. These are CITS product limits sized for a client base under 50,000 messages a month, and are configuration values, not constants in code.

**IM-2a (performance target).** A **10,000-row** file must complete the full validation and commit pipeline within **5 minutes** end to end. This is the target the import worker is sized and tested against; the 20,000-row hard cap of IM-2 is the ceiling, not the performance case.

**IM-3.** A downloadable template file (both formats) must be offered on the upload screen, with the expected column headers and two example rows.

**IM-4.** After upload the system must show a column-mapping screen: detected headers on the left, system fields on the right, with auto-detection by fuzzy header match (for example "Mobile", "Mobile No", "Phone", "WhatsApp Number" all suggest the phone field). The user can override every mapping, and can mark a column as "ignore". Only the phone column is mandatory.

**IM-5.** Unmapped columns must be discarded, not silently stored. The preview must state how many columns are being discarded.

### 9.2 Validation pipeline

**IM-6.** Validation must run in this exact order, and a failure at any stage must stop that row without stopping the file:

| Order | Stage | Failure outcome |
|---|---|---|
| 1 | File type and size check | File rejected |
| 2 | Row cap check | File rejected |
| 3 | Header mapping applied | File rejected if no phone column mapped |
| 4 | Per-row phone normalisation to E.164 (CT-7, CT-8) | Row marked invalid |
| 5 | Duplicate detection within the file | Later occurrence marked duplicate; first wins |
| 6 | Duplicate detection against existing workspace contacts | Row marked update, not insert |
| 7 | Consent field handling (§9.4) | Row imported with consent unknown |
| 8 | Cross-check against the global suppression and opt-out list | Row imported but forced to opted-out |

**IM-7.** Stage 8 is not optional and has no override. A number on the suppression list must be imported as opted-out even if the spreadsheet column says "Yes". An import must never be able to un-opt-out anybody.

**IM-8.** Cell values must be treated as hostile data at all times: parameterised database access only (Drizzle's query builder, never string-concatenated SQL), no cell value ever passed to a shell, formula-leading characters (`=`, `+`, `-`, `@`) escaped on export to prevent CSV injection, and all text fields length-capped before storage.

### 9.3 Background processing, history and undo

**IM-9.** Import must run in a queued BullMQ worker. The web request must do nothing but store the file, create an import job record and return. A 20,000-row file must never be parsed inside an HTTP request.

**IM-10.** The import job must report progress (rows processed / total, current stage) at least every 500 rows, visible on the import screen without a page reload. Jobs must be cancellable while running; cancelling stops further rows and keeps rows already committed.

**IM-11.** Every import must produce a history record: file name, uploaded by, upload timestamp, mapping used, declared consent source and date, total rows, imported (new), updated (existing), duplicates within file, invalid, skipped, and forced-to-opted-out. History is retained and is never editable.

**IM-12.** Every import with at least one problem row must produce a downloadable **error report** — the original rows that failed, in their original column order, with an appended `error_reason` column. The user fixes that file and re-uploads it directly. The error report must be downloadable for at least 90 days.

**IM-12a (undo import — the only rollback that exists).** There is **no general import rollback**. What exists is a narrow **"undo import"**, available for **24 hours** after the import completes, and it does exactly one thing: it deletes contacts that were *created* by that import and that have not since been messaged and have not since replied. Precisely:

| Undo import does | Undo import never does |
|---|---|
| Delete contacts created by this import with no send history and no inbound message | Reverse an opt-out, including one applied by stage 8 |
| Show the exact count it will delete before it runs | Revert field updates made to contacts that already existed |
| Write an audit-log entry naming the user, the import and the count (§18) | Re-create contacts, groups or tags it did not create |
| Expire silently after 24 hours, after which the import is permanent | Run automatically, or run twice on the same import |

Contacts created by the import but since messaged or since replied are left untouched and are listed in the undo confirmation as "kept". Any hard deletion performed by an undo still writes a suppression entry where CT-27 requires one. Undo is restricted to Super Admin, Client Admin, and the Campaign Manager who performed the import, and in every case only within the 24-hour window.

### 9.4 Consent on import

An import is the single easiest way for this product to cause a compliance incident: one spreadsheet can assert consent for twenty thousand people who never gave it.

**IM-13.** Before an import can be committed, the uploader must supply, in a required form: the **consent source**, the **consent date** (a single date, or a per-row column if the file carries one), and a free-text description of how consent was obtained. `website_form` here means consent was collected on the **client's own** website and is being imported alongside the contact; CITS hosts no public opt-in form in v1 (see §10 and the roadmap).

The consent-source picker offers **friendly UI labels mapped onto the normative `source_type` values defined on the consent record in the data model (§21)** — the picker never introduces a value of its own, and what is stored is always the `source_type`. The mapping is:

| UI label shown to the uploader | Stored `source_type` (§21) |
|---|---|
| Membership form | `paper` or `website_form`, depending on how it was collected — the uploader is asked which |
| Event registration | `website_form` |
| Paper form | `paper` |
| Journal submission system | `website_form` |
| Existing member database | `import` |
| Other (free-text note required) | `import`, with the note retained on the consent record |

**IM-14.** These values must be recorded against **every contact created or updated by that import**, not just against the import job, so that a single contact's consent provenance is answerable years later without reconstructing the import.

**IM-15.** The uploader must tick an explicit confirmation naming the client organisation and the row count — for example, "I confirm that these 4,210 people gave [Society] permission to receive WhatsApp messages from [Society], and that CITS has been provided with evidence of that consent." The tick, the exact wording shown, the user and the timestamp are stored on the import record and are audit-logged (§18).

**IM-16.** If the file contains no consent column and the uploader does not declare a consent source, the import must complete with every affected contact set to consent status **unknown**, and unknown-consent contacts must be excluded from all marketing campaigns by default. Import must never default to "consented".

**IM-17.** An import must never be able to change a contact from opted-out to opted-in. Restoring consent after an opt-out is a per-contact action with its own evidence, described in §10.

### 9.5 Dry run

**IM-18.** Every import must offer a **preview / dry-run** mode that runs the entire validation pipeline and writes nothing. The preview must show: the first 20 mapped rows as they would be stored, and the full counts for would-be created, updated, duplicate, invalid, and forced-to-opted-out, with the reasons broken out.

**IM-19.** Committing an import must be a separate, explicit action taken after the preview. The preview result must be reusable for at least one hour so the user is not made to re-upload.

---

## 10. Consent and opt-out

### 10.1 Why this section is written as hard rules

Consent failure is the single fastest route to losing every client at once. Because CITS owns one business portfolio and all sender numbers sit inside it, messaging limits, quality signals and enforcement are pooled at the **business portfolio** level (since 2025-10-07). One society's badly-sourced list produces blocks and reports that degrade the daily unique-recipient cap for every other client. And because a WABA can never be migrated to another portfolio, there is no escape hatch: a number that gets restricted cannot be handed anywhere else. Meta's enforcement ladder runs warning → 1–3 day category restriction → 5, 7 or 30 day block on all messaging → indefinite lock → permanent removal. Appeals are decided in 24–48 hours, and consent evidence is the primary defence. Everything below exists to make that defence producible in minutes.

### 10.2 Meta's actual opt-in rule

Meta's business policy states that you may only contact people on WhatsApp if: (a) they have given you their mobile phone number; **and** (b) you have received opt-in permission from the recipient confirming that they wish to receive subsequent messages or calls from you.

The trailing clause is load-bearing. **Possessing a phone number is not consent.** A membership database, a conference registration spreadsheet, a journal's author records and a purchased list are all "we have the number" — none of them are opt-in on their own.

**The material exception:** the same policy permits replying to a user's message without a template within 24 hours of that user's last message. The opt-in rule therefore governs **business-initiated** messaging only.

- **OO-1** The system must apply the consent gate only to business-initiated messages (campaign sends, and any template send not made in reply inside an open customer service window).
- **OO-2** The system must never block, hide or delay an inbound message from a WhatsApp user, and must never block an Inbox Agent's reply inside an open 24-hour window on consent grounds. A suppressed contact who writes in must still appear in the inbox and must still be answerable.
- **OO-3** The system must never allow a campaign to be launched against an audience whose contacts lack a recorded consent event of the required category. Missing consent is a hard block, not a warning.

### 10.3 How opt-in may be collected

Meta explicitly leaves the method to the business: "It is up to businesses to determine the method of opt-in." A website form, an SMS reply, a phone or IVR confirmation, and an in-person paper form are all acceptable. Since the November 2024 policy update, consent may be **general** rather than WhatsApp-specific.

Three hard requirements apply to whatever wording is used:

1. It must state that the person is opting in to receive communication from the business.
2. It must clearly state the business's name.
3. It must comply with applicable law.

Meta additionally directs businesses to communicate the **categories** of message a person will receive, to give clear opt-out instructions per category, and to honour those requests.

- **OO-4** The system must ship a reusable, per-client consent-wording template that names the client organisation, names WhatsApp as the channel, and lists the message categories. The wording actually shown must be stored with each consent record (OO-6), not merely referenced.
- **OO-5** The system must allow a consent record to be created from any of these `source_type` values, and must record which one it was: `website_form` (consent collected on the **client's own** website and imported alongside the contact — see §9 Contact import), `sms`, `ivr`, `paper` (a registration or in-person paper form), `import` (a column in a contact import file), `inbound_reply` (an inbound WhatsApp message), `opt_out_button`, `user_preferences_webhook`, `error_131050`, or `off_platform_request`. This enumeration is normative: it is the same list carried on the consent record in the data model, and no other value may be written. The contact import screen's friendlier labels are presentation only and map onto these values (see §9 Contact import).
- **OO-37** **CITS hosts no public opt-in form in v1.** `website_form` describes consent captured by the client on their own property and carried in with the contact data; it does not imply any CITS-hosted, publicly reachable page. No screen, help text or data dictionary entry may describe a CITS-hosted opt-in form, and no such URL may be issued. A hosted public opt-in form is a **roadmap** item, out of scope for v1.

### 10.4 The consent record CITS keeps

**Meta prescribes no record format and no retention period for consent evidence.** The schema below is CITS product policy, shaped by data-protection law (see §20 Compliance), not by a Meta requirement.

| Field | Notes |
|---|---|
| Phone number | E.164, normalised at write time |
| Phone-number hash | Stable hash of the normalised number; survives redaction and erasure |
| Consent timestamp | UTC, stored to the second |
| Direction | Opt-in or opt-out |
| Source type | One of the `source_type` values in OO-5 |
| Source detail | Client URL, form identifier, import batch ID, or registration event ID |
| Verbatim consent wording | The exact text displayed to the person, copied — not a foreign key to a mutable template |
| Channel disclosure | Explicit confirmation that WhatsApp was named as a channel |
| Business/sender name shown | The name the person actually saw |
| Categories consented to | Marketing, utility, authentication — multi-valued |
| IP address and user agent | Where the source was a client web form; otherwise the registration or event identifier |
| Captured by | User ID and client workspace, where entered by staff |

- **OO-6** Consent and opt-out records must be append-only. The system must never update or delete a consent row; a change of state is a new row.
- **OO-7** The system must export a single contact's full consent and opt-out history as a CSV or PDF within one click from the contact profile, and export a whole client's history as a file. This is the artefact submitted with an enforcement appeal, which Meta decides in 24–48 hours.
- **OO-36** **Retention is settled here and every other section must match it.** This is CITS product policy, not a Meta rule.
  - **Opt-in evidence** is retained for the life of the client relationship plus **three years**, and at the end of that period is **redacted, never deleted**.
  - A **redacted consent record** retains exactly: the phone-number hash, the direction, the categories, the timestamp and the source type. All other fields — plaintext phone number, verbatim wording, IP address, user agent, source detail, captured-by — are cleared.
  - **Opt-out and suppression records are retained indefinitely** and are never redacted away, because a suppression that expires is a suppression that fails.
  - Redacted consent records and all opt-out records **survive contact erasure**. Contact erasure removes the contact and its content; it must not remove the consent and suppression trail, because that trail is precisely the evidence needed to defend an enforcement appeal and to keep honouring an opt-out for a number whose contact record no longer exists. The erasure path must be built to leave this trail intact.

### 10.5 Opt-out keyword detection

- **OO-8** The system must scan every inbound text message against a keyword list before any other processing. The v1 English list: STOP, UNSUBSCRIBE, REMOVE, NO, OPT OUT, OPTOUT, DON'T MESSAGE, DONT MESSAGE.
- **OO-9** The list must include Hindi and common Indian-language equivalents, stored as data and editable per deployment without a code change. Seed set: रोको, बंद करो, बंद, हटाओ, नहीं, मैसेज मत भेजो, unsubscribe करो, plus transliterated forms (band karo, band, hatao, nahi, rok do, mat bhejo). Bengali (বন্ধ করুন), Tamil (நிறுத்து), Telugu (ఆపండి), Marathi (थांबवा) and Gujarati (બંધ કરો) should be added as client language mix demands.
- **OO-10** Matching must be case-insensitive, must ignore leading and trailing whitespace, and must ignore surrounding punctuation and emoji.
- **OO-11** Matching must distinguish a **bare keyword** (the message consists only of the keyword, after normalisation) from a **keyword inside a longer sentence**. A bare keyword must trigger immediate automatic opt-out. A keyword inside a longer sentence must trigger automatic opt-out for the unambiguous keywords (STOP, UNSUBSCRIBE, OPT OUT, REMOVE, DON'T MESSAGE) and must raise a human-review task for the ambiguous ones, assigned to the workspace's Inbox Agents.
- **OO-12** "NO" and "नहीं" must be treated as ambiguous by default: bare "NO" opts the contact out; "no" appearing inside a longer message must create a human-review task and must not auto-suppress. This behaviour must be configurable per client workspace, with the safe default on.

CITS policy note: erring toward suppression is always the cheaper mistake. A wrongly suppressed member can be re-opted-in by a human under the manual re-opt-in requirement (OO-26); a wrongly retained member files a block, which feeds portfolio-wide quality.

### 10.6 The other opt-out sources

Keyword detection alone catches perhaps half of real opt-outs. All of the following must write to the same suppression record.

| Source | Signal | Notes |
|---|---|---|
| Opt-out quick-reply button tap | Inbound interactive message carrying the button payload | The cleanest signal; handled on the inbound opt-out event pathway (OO-22), not the `user_preferences` pathway |
| WhatsApp's native "Offers and announcements" setting | `user_preferences` webhook, stop/resume events | **Meta accepts your send request and then silently does not deliver.** Nothing in the send response reveals this. Interested/Not-interested feedback does not fire this webhook |
| Send-time rejection | (`/messages`, **131050**) — user opted out of marketing | Classified `TERMINAL`; write to suppression, never retry |
| Off-platform request | Email, phone call, conference registration desk, letter | Meta's obligation covers requests made "either on or off WhatsApp" |

- **OO-13** The system must subscribe to the `user_preferences` webhook field and must treat a stop event as an immediate marketing suppression for that phone number, and a resume event as a Meta-side resume that does **not** by itself clear a CITS-side opt-out.
- **OO-14** The system must treat (`/messages`, 131050) on a send as a terminal opt-out, write it to suppression, and never retry that message.
- **OO-15** The system must provide a manual opt-out action, available from the contact profile, the inbox, and as a bulk action from a contact list, with a mandatory free-text field for the source of the request. Suppression must never be derivable only from inbound WhatsApp events.

### 10.7 One global suppression list

- **OO-16** The system must maintain a single suppression list keyed on the normalised E.164 phone number, honoured across every campaign, every sender number and every client workspace. It must not be per-campaign and must not be per-client.

The reasoning is practical, not legal minimalism. The same person is frequently a member of two societies CITS serves — an agronomist on an agricultural association's roll and an author in a journal's database. That person opted out of WhatsApp messages, not out of one society. Honouring the opt-out in one workspace and continuing in another produces exactly the block that damages the shared portfolio.

- **OO-17** The suppression list must support a category dimension (marketing suppressed, utility still permitted). The default for every opt-out event must be **global across all categories**. Narrowing to marketing-only must require an explicit action with a recorded reason — for example, a `user_preferences` stop event, which is marketing-scoped by nature.
- **OO-18** Suppression records must be visible to every client workspace as a status, but the originating client, the source text and the Inbox Agent notes must not be exposed across workspaces (see §19 Security).

### 10.8 Suppression is not blocking

These are two different objects and must be modelled separately.

| | CITS suppression | Meta Block Users API |
|---|---|---|
| Owner | Ours, in our database | Meta's, per business phone number |
| Size limit | Unbounded | **64,000 users per phone number** |
| Batch limit | None | **1,000 users per request** |
| Precondition | None | **Only users who have messaged you in the last 24 hours can be blocked** |
| Effect | We stop sending | Meta stops the user reaching us |

- **OO-19** Every opt-out event must write to CITS suppression. Meta-side blocking must be an explicit, separate action initiated by a user holding Inbox Agent, Campaign Manager or Client Admin in that workspace, used for abuse and harassment only — never an automatic consequence of an opt-out.
- **OO-20** The block action must be disabled in the UI when the contact has not messaged within 24 hours, with the reason shown. Because the error classification table is keyed on (api_surface, code), all of the following are the `/block_users` meanings and must not be confused with the `/messages` meanings of the same codes: (`/block_users`, **131047**) target has not messaged in 24 hours; (`/block_users`, **139101**) blocklist limit reached — classify `OPERATIONAL_ALERT`, because blocking silently stops working; (`/block_users`, **139100**) bulk operation partially failed — the system must report exactly which entries failed; (`/block_users`, **130429**) request rate limit; (`/block_users`, **131021**) self-block.
- **OO-21** Because a bulk retroactive block is impossible by design, the product must never present blocking as a way to clean a list.

### 10.9 What happens on opt-out

- **OO-22** On any opt-out event — keyword match, opt-out quick-reply tap, `user_preferences` stop, (`/messages`, 131050), or a manual entry — the system must, in a single transaction: mark the contact opted out; record the UTC timestamp, the source type, and the identifier of the triggering inbound message or send failure; and remove the contact from every queued and scheduled campaign send. This is the **inbound opt-out event pathway** referred to elsewhere in this section.
- **OO-23** Already-queued jobs for that contact must be cancelled, not merely skipped at delivery — and if a job is already in flight, the pre-send check in OO-27 must stop it.
- **OO-24** The opted-out status must be shown prominently in the contact profile and in the inbox conversation header, with the date and source visible without a further click.
- **OO-25** Where the opt-out arrived over WhatsApp, the system must send one confirmation message inside the open 24-hour window confirming the person has been unsubscribed and naming the client organisation. Exactly one — never a follow-up, never a "are you sure".

### 10.10 Manual opt-out and re-opt-in

- **OO-26** Re-opt-in must require a written reason of at least 20 characters; must be restricted to Client Admin or Super Admin, or to another workspace role only where the "re-opt-in a contact" permission has been explicitly granted (see §6 Users, roles and permissions); must be fully audit-logged with the acting user; and must display a blocking warning that re-opting-in a person who did not ask to return is a WhatsApp policy violation that can restrict every CITS client's messaging. Every opt-in and opt-out transition is retained under OO-36.

### 10.11 The pre-send check runs twice

- **OO-27** The system must run the pre-send check twice: once when a campaign audience is resolved at build time, so the user sees the true recipient count in the pre-flight summary; and again immediately before each individual message is handed to the WhatsApp API, because a person may opt out mid-campaign. A campaign that takes an hour to drain must not send to someone who opted out in minute five. At both points the check runs in this order, and each step is a **separate, separately-counted exclusion reason**:
  1. **No recorded consent** of the required category (OO-3).
  2. **Global suppression** — the contact is on the suppression list for this category (OO-16).
  3. **CITS frequency governor** — the contact has already received the configured ceiling of marketing messages in the rolling period (OO-38).
- **OO-38** The system must enforce a **CITS-side frequency governor**: a configurable per-contact ceiling on marketing messages per rolling period, settable per client with a platform-wide default (CITS product policy; suggested default 4 per 30 days per client). It is enforced at both pre-send checkpoints, and it is **independent of, and must never be conflated with, Meta's per-user marketing cap** (which surfaces only at send time as (`/messages`, 131049)). In the pre-flight summary and the campaign report it appears as its own exclusion reason — "blocked by CITS frequency governor" — distinct from "suppressed" and distinct from "blocked by frequency cap".
- **OO-28** Both checkpoints must be recorded, and the campaign report must show suppressed-at-build and suppressed-at-send as separate counts, with the frequency-governor exclusions itemised separately again (see §15 Reporting).

### 10.12 Opt-out language in templates

Be precise here, because the industry is not.

- Meta's documentation describes an opt-out quick reply as a **common use case**, with examples such as "Unsubscribe from Promos" and "Unsubscribe from All". It does **not** state that such a button is mandatory or automatically appended, and **there is no `MARKETING_OPT_OUT` button type in the API** — the button type enum is CATALOG, COPY_CODE, FLOW, MPM, OTP, PHONE_NUMBER, QUICK_REPLY, URL. The "Meta mandates it / Meta adds it for you" claim appears only in third-party BSP blogs.
- Likewise, a "Reply STOP to unsubscribe" footer is widespread industry practice, **not a verifiable Meta mandate**.

- **OO-29** The template composer must add an opt-out `QUICK_REPLY` button to every MARKETING template by default (CITS product policy, strongly recommended). The user may remove it, with a one-line confirmation.
- **OO-30** The UI must never tell users that Meta requires an opt-out button or footer. The help text must say this is CITS's own standard, adopted because Meta requires clear per-category opt-out instructions to be provided and honoured.
- **OO-31** A tap on that button arrives as an **inbound interactive message**, not as a native WhatsApp preference change. It must therefore be routed through the inbound opt-out event pathway in **OO-22** — matched on the button payload rather than on keyword text — and must never be left as an unrouted inbound message. It does **not** travel the `user_preferences` webhook path in OO-13, and the two pathways must not be wired together.

### 10.13 Service level

Meta sets **no numeric deadline** for honouring an opt-out. The following is CITS product policy:

- **OO-32** Automated opt-outs (keyword, button, `user_preferences`, (`/messages`, 131050)) must take effect immediately — within one processing cycle of the webhook, and always before the next send to that number.
- **OO-33** Opt-out requests requiring human action (review cases from OO-12, off-platform requests) must be resolved within **24 hours** of arrival, with an internal alert when any case ages past 12 hours.

### 10.14 Prohibited features

- **OO-34** The system must never offer any feature that presents additional phone numbers, additional WABAs or additional providers as a way to reach a user who has hit Meta's per-user marketing cap ((`/messages`, 131049)), who has hit the CITS frequency governor, or who has opted out. Meta's cap is enforced on the recipient's side and rotating senders does not work; attempting it is a policy violation that risks the entire portfolio.
- **OO-35** The system must never bulk-import contacts into a campaign-eligible state without a consent source recorded for the batch (see §9 Contact import).

---

## 11. Templates

### 11.1 Why templates exist

Outside the 24-hour customer service window, an approved template is the only message WhatsApp will deliver (see §13 Sending engine). Every campaign CITS runs for a society, journal or conference is business-initiated and therefore template-only. A template is a pre-registered message shape — header, body, footer, buttons and typed placeholders — that Meta has reviewed and approved before a single message is sent.

**TP-1** A campaign MAY be created and scheduled against a template whose status is `PENDING`, provided the campaign wizard (§12) shows a clear warning that the template is not yet approved. The **sending engine** must refuse to release any message whose template is not `APPROVED` for the exact language being sent. Templates in `PAUSED`, `DISABLED` or `REJECTED` status must remain visible in the template list but must be unselectable in the campaign wizard. This rule and TP-22 describe the same behaviour and must not be read as two different gates: the selection gate is soft at `PENDING` and hard at `PAUSED`/`DISABLED`/`REJECTED`; the release gate is absolute.

**TP-2** The system must treat template status and template quality as two independent fields. A template can be `APPROVED` with a `RED` quality score, or `PAUSED` with a `GREEN` score recorded from before the pause. The system must never derive one from the other.

### 11.2 Stored fields

Every template record is owned by exactly one client and lives on exactly one WhatsApp Business Account (WABA) — **not** on a sender number. A template is usable by **any** sender number attached to that WABA (see §5 Multi-client management, §7 WhatsApp sender numbers). Changing which sender number a campaign sends from does not change which templates are available, so long as the number is attached to the same WABA.

| Field | Notes |
|---|---|
| Client, WABA | Ownership, and the WABA the template lives on. No sender-number binding is stored |
| Template name | Lowercase alphanumeric and underscores only, max 512 characters, unique per language per WABA |
| Display title | CITS-internal human label; never sent to Meta |
| Language | BCP-47 style locale code as Meta expects it |
| Category | `MARKETING`, `UTILITY` or `AUTHENTICATION` |
| Header, body, footer, buttons | Structured components, stored as authored |
| Variables and sample values | Name or position, mapped contact field, fallback value, sample value sent to Meta |
| Approval status | `APPROVED, ARCHIVED, DELETED, DISABLED, IN_APPEAL, LIMIT_EXCEEDED, PAUSED, PENDING, PENDING_DELETION, REJECTED` |
| Quality score | `GREEN, YELLOW, RED, UNKNOWN` — separate dimension |
| Meta template id | Returned at creation; used for edit, unpause, delete |
| Template version id | CITS-internal, immutable per version; this is the identifier campaigns and the send outbox reference (see §13) |
| Rejection reason | `INVALID_FORMAT, ABUSIVE_CONTENT, PROMOTIONAL, SCAM, INCORRECT_CATEGORY` |
| Rejection recommendation | Meta's free-text `recommendation` on format rejections |
| Correct-category hint | Meta's `correct_category` value, when present |
| Notes | CITS-internal working notes |

**TP-3** The system must store the full component structure of a template, not a flattened rendered string, so that character counts, variable positions and button types can be re-validated without re-parsing text.

**TP-3a** Every template edit creates a new immutable **template version** with its own template version id. The send outbox uniqueness key is (campaign_id, recipient_id, template_version_id, attempt_key), so the version id — never the mutable template id — is what a campaign and its outbox rows reference.

### 11.3 The three categories and the cost they decide

Exactly three categories exist: **Marketing**, **Utility**, **Authentication**. "Service" is a pricing concept for free-form in-window replies, not a template category, and must not appear in a category picker.

The classification rule is strict. **Utility requires both** (a) non-promotional intent, with no persuasive or promotional content, **and** (b) either being specific to or requested by the user, **or** being essential or critical to the user. Anything that mixes utility and promotional content is Marketing. Anything whose intent cannot be determined is Marketing.

This matters because since **2025-04-09** the `allow_category_change` behaviour is the default. A template submitted as Utility that Meta judges to be Marketing is **silently approved as Marketing** — not rejected. The author sees a green "Approved" badge and then gets billed at the marketing rate, which is roughly 7.5× the utility rate in India and carries no volume discount.

**TP-4** The composer must display a projected per-message cost at the category Meta is likely to assign, not the category the author selected. Where CITS's classification check disagrees with the author's selection, the system must show both figures side by side and require the author to acknowledge the higher one before submission.

**TP-5** The classification check must be a rule set stored as data, not code, so it can be tuned without a deploy. It must flag, at minimum: calls to action, discount or offer language, event promotion, and any message not plainly tied to an action the recipient took. This checklist is CITS product policy; Meta publishes no scoring rubric.

**TP-6** After approval, the system must record and display the category Meta actually assigned, and must raise a notification (see §18) whenever the assigned category differs from the submitted one.

### 11.4 Recategorisation

Two separate Meta processes, often conflated, must be modelled separately.

1. **Utility → Marketing runs daily and continuously** — not monthly. Normal practice is a **one-day (24-hour) advance notice**. Effective **2025-04-16**, businesses previously warned for categorisation misuse receive **no advance notice at all**; the category changes immediately and notification arrives afterwards.
2. **Only the authentication-rejection path is monthly**: a Marketing or Utility template judged to actually be an authentication template has its status set to `REJECTED` on the first day of the following month.

**TP-7** The system must subscribe to and handle the `template_category_update` webhook, recording `previous_category`, `new_category` and `correct_category` against the template and writing an audit entry.

**TP-8** The system must poll the Message Templates API on a scheduled job (CITS policy: daily) and flag any template where `correct_category` is non-empty and differs from `category`. This is the only advance warning available when the 24-hour notice is not given, and it must raise a notification to the workspace's Client Admins with the projected cost impact.

**TP-9** The system must record the template creation date and the date of any category update, and must surface the remaining days in the **60-day appeal window** (measured from creation, or from the category-update date). The system must state that appeal eligibility is restricted to Utility/Marketing templates in `REJECTED` status and Marketing templates in `APPROVED` status, and must not offer an appeal button where the template is ineligible.

### 11.5 Structure limits

| Component | Limit the composer must enforce |
|---|---|
| Text header | 60 characters, **exactly one** parameter, no markdown formatting |
| Media header | One asset: image, video, GIF or document, uploaded via the Resumable Upload API. GIF is available only on the Marketing Messages API path, max 3.5 MB |
| Location header | Utility or Marketing categories only; the coordinates are supplied at send time; live location not supported |
| Body | 1024 characters, multiple parameters allowed. Body is the only required component |
| Footer | 60 characters, text only, **no parameters** |
| Buttons | 10 total across all types |
| Quick reply | Up to 10 |
| URL button | Maximum 2. URL up to 2000 characters. **Exactly one variable, appended only to the end of the URL string** |
| Phone number button | Maximum 1, 20-character number |
| Copy code button | Maximum 1, 20-character code |
| Button label | **[Verify before build]** Meta's table states 25 characters; several third-party BSP docs state 20. Build the counter to **20** and revisit once confirmed against Meta's live components page |

**TP-10** The composer must warn, without blocking, when a template has four or more buttons: those collapse behind a "See all options" control and are **not supported on WhatsApp desktop**.

**TP-11** The composer must require quick-reply buttons to be grouped contiguously and must never allow them to be interleaved with URL, phone-number or copy-code buttons.

**TP-12** The button type picker must offer only `QUICK_REPLY`, `URL`, `PHONE_NUMBER`, `COPY_CODE`, `OTP`, `FLOW`, `CATALOG` and `MPM`. There is no `MARKETING_OPT_OUT` button type; an opt-out button is built as a normal quick reply (see §10 Consent and opt-out).

### 11.6 Parameters

Meta supports **named** parameters (`{{first_name}}`, lowercase with underscores, unique within the template) and **positional** parameters (`{{1}}`, sequential from 1). **Positional is the default when `parameter_format` is not set.**

**TP-13** The system must set `parameter_format` explicitly on every create call and must never rely on the default.

**TP-14** Sample values are mandatory at creation. The composer must block submission until every variable has a sample value.

**TP-15** Every variable must have a **fallback value** stored alongside its contact-field mapping. At send time a missing contact value must render the fallback. The system must never render an empty gap or the literal placeholder text into a delivered message.

**TP-16** The composer must block, as CITS product policy: a body that begins or ends with a variable, two adjacent variables with no text between them, non-sequential positional parameters, and more than one variable per 40 characters of body text. Meta does not state the first two rules verbatim; they are enforced here as cheap insurance against "dangling parameter" rejections and must not be presented to users as Meta rules. Meta does publish "non-sequential or dangling parameters" and "too many variables relative to message length" as rejection causes; no numeric cap on variables per body is published.

**TP-17** Template names must be validated as lowercase alphanumeric plus underscores, max 512 characters, and checked for uniqueness **per language per WABA** before submission. Because the uniqueness scope is the WABA and not the sender number, the check must be run against every template on the WABA regardless of which number the campaign will send from. A duplicate returns error 100 with subcode 2388024 and must be surfaced as a plain-English "a template with this name already exists in this language on this WhatsApp Business Account."

### 11.7 The composer and validation

**TP-18** The composer must render a live WhatsApp-style preview updating on every keystroke, showing header, body, footer and buttons as the recipient will see them.

**TP-19** Every length-limited field must show a live character counter that turns red at the limit and blocks submission past it.

**TP-20** The composer must let the author map each variable to a contact field (see §8 Contacts, groups and tags) or a fixed value, and must offer a **sample render against three real contacts drawn from the intended audience**, so unusual real data is seen before submission. Where the viewing user is a Viewer without the "View full phone numbers" permission, any phone number shown in a sample render must be masked to the last 4 digits.

**TP-21** The composer must present a single blocking validation list. Submission to Meta must be disabled while any blocking item is unresolved. Non-blocking advisories (desktop button collapse, category cost warning, pending-template warning) must be visually distinct from blocking errors.

**TP-21a** Template creation, editing and submission require **Campaign Manager**, **Client Admin** or **Super Admin**. **Inbox Agent** and **Viewer** have read-only visibility of templates and no composer access.

### 11.8 Submission and approval

Templates are created, read, edited and deleted entirely through the Message Templates API. **There is no dependency on Meta's WhatsApp Manager UI** — the CITS composer is the only interface a client ever needs to see.

Review is automated machine review plus manual review and takes **up to 24 hours**. Appeals take approximately the same.

**TP-22** The system must never assume instant approval. The campaign wizard (§12) must handle the "template still pending" state explicitly, consistent with TP-1: the campaign may be drafted, submitted and scheduled while the template is `PENDING`, with a persistent warning on the campaign; the sending engine must refuse to release it while the template is not `APPROVED` for the language being sent; and the system must notify the campaign creator and the workspace's Client Admins if the template is still pending as the scheduled time approaches. The two possible outcomes at fire time must be distinguished (consistent with §12 Campaigns): where the template is still `PENDING`, or is awaiting re-approval after an edit, the campaign remains in `scheduled` and is refused at pre-flight — there is no separate blocked state — until the approval lands or the operator cancels the campaign; where the template is `REJECTED`, `PAUSED` or `DISABLED` at fire time, the campaign moves to `failed` with the reason recorded.

**TP-23** The system must handle the `message_template_status_update` webhook and all its events: `APPROVED, REJECTED, PAUSED, DISABLED, PENDING_DELETION, FLAGGED`.

**TP-24** On an `INVALID_FORMAT` rejection, the system must display Meta's `recommendation` text verbatim to the template author, alongside the `reason` code translated into plain English.

**TP-25** A `REJECTED` template must offer edit-and-resubmit, recategorise-and-resubmit, and — where eligible — appeal (an appeal submission must include a sample). A `DISABLED` template must not offer an appeal; the interface must state that it cannot be appealed and must offer "duplicate into a new template" instead.

### 11.9 The pausing ladder

| Offence | Consequence |
|---|---|
| First | Paused **3 hours** |
| Second | Paused **6 hours** |
| Third | **Disabled permanently, no appeal** |

The trigger is recurring negative feedback from recipients **or low read rates**. Read rate is an explicit quality input to Meta's system, not merely an engagement metric that CITS reports on.

**TP-26** Because read rate feeds pausing, the campaign wizard must warn when a template is about to be sent to an audience with a historically low read rate, and must recommend narrowing the audience rather than broadening it. The read-rate threshold used for this warning is CITS product policy — Meta publishes no threshold. Where the historic read rate was never captured inside Meta's 7-day analytics window, it must render as **"not captured"**, never as zero, and must not trigger the warning.

**TP-27** The system must record each pause event with its timestamp and Meta's `other_info.title` value (`FIRST_PAUSE` / `UNPAUSE`), display the offence count, and offer a manual unpause action calling `POST /{template_id}/unpause`. Whether Meta resets the offence counter after a period of good performance is **not documented** — the system must display the count as cumulative and never claim it has reset.

**TP-28** The system must display template `quality_score` (GREEN / YELLOW / RED / UNKNOWN) and must handle the `message_template_quality_update` webhook, storing `previous_quality_score` and `new_quality_score` as a history so degradation trends are visible.

### 11.10 Volume limits

The template ceiling is **per WABA**, not per sender number. A WABA may hold **250 templates while its parent business portfolio is unverified**, rising to **up to 6,000** once the portfolio is verified and at least one WABA has a phone number with an approved display name. CITS's portfolio is already verified, so the higher ceiling applies — but **each language counts as a separate template**, so a 20-template library in three languages consumes 60 slots on that WABA. Adding further sender numbers to a WABA does not increase the ceiling. Creation is rate-limited to **100 templates per WABA per hour**.

**TP-29** The system must display a live template-count-against-ceiling indicator **per WABA** and must warn at 80% of the applicable ceiling. The 80% warning point is CITS product policy.

**TP-30** The system must throttle its own template creation to stay under 100 per WABA per hour, queueing bulk library installs rather than failing them.

### 11.11 Authentication templates

Authentication templates are a separate, tightly constrained shape, not a free composer. The body is **fixed preset text** — a verification-code sentence with no custom wording. Optional additions are a security disclaimer ("For your security, do not share this code"), an expiry footer stating a duration between **1 and 90 minutes**, and copy-code, one-tap autofill (Meta's preferred) or zero-tap buttons.

**[Verify before build]** The constraints "no URLs, media or emoji anywhere in content or parameters" and "parameters capped at 15 characters" are medium-confidence in the fact base and must be confirmed against Meta's authentication-templates page before the validator enforces them as hard blocks.

**TP-31** v1 must be able to **store, submit and send** authentication templates, but must not build a bespoke authentication composer. Scientific societies, journals and conferences rarely need OTPs, and the effort is better spent elsewhere. Where a client genuinely needs one, it is created through the generic component form with the category set to Authentication. A dedicated authentication composer is deferred to §24 Roadmap.

### 11.12 Links and shorteners

**TP-32** The composer must block generic URL shorteners — including but not limited to bit.ly, tinyurl, goo.gl, t.co, rebrand.ly and is.gd — in any body text or URL button, at validation time, before submission.

This prohibition is **not stated on any currently-live Meta page**. It is reproduced consistently across BSP documentation as Meta's historical guidance, and in practice enforcement happens through `SCAM` and `ABUSIVE_CONTENT` rejections and through quality degradation after sending. The block is therefore CITS product policy grounded in observed enforcement, not a citable Meta rule, and the composer's error message must say so plainly rather than claiming Meta forbids it.

The correct approach is a business-owned, DNS-verified HTTPS short-link domain with the tracking token appended to the end of a URL-button variable. See §16 Click tracking for the domain, token and redirect design.

### 11.13 Template library and versioning

**TP-33** CITS must maintain a starter library of pre-authored templates. **This library is the same artefact as the client use-case table in §1** — it is not a separate list, and the two must never drift. Every row of the §1 use-case table (call for papers, abstract submission received, review assignment, review reminder, decision notification, registration confirmation, event reminder, membership renewal due, payment receipt, and any row added later) corresponds to exactly one starter template family in this library, and every starter template traces back to a row in that table. Each carries a correct category assignment and a plain-English note on why it is Utility or Marketing. Adding a use case to §1 without adding the corresponding starter template, or vice versa, is a defect. Library templates must be copyable into any client with one action, onto that client's WABA, with the client's name and details substituted.

**TP-34** Meta's own Template Library may be used as a starting point, but the system must state that **customised library templates still go through full review** and must not be presented as pre-approved.

**TP-35** The system must snapshot a template's complete content — components, category, language, template version id and variable mappings — onto the campaign record at the moment the campaign is released, and must never mutate that snapshot. A report generated months later must be able to reproduce exactly what was sent, even if the live template has since been edited, recategorised, paused or deleted.

**TP-36** Editing an approved template resets it to `PENDING` review and creates a **new template version**. Before the edit is committed, the composer must warn the author that the edit resets approval, and must **list by name every campaign currently in `scheduled` or `pending_approval` state that references this template**, together with each campaign's scheduled time and workspace. The author must confirm against that list to proceed. Editing must never affect campaigns already sent, and must never mutate the snapshot held by any campaign that has already been released (TP-35).

**TP-37** On commit of a template edit, every campaign in `scheduled` or `pending_approval` that references the edited template must be flagged in the campaign list and on the campaign detail screen as "template awaiting re-approval". Those campaigns remain in their existing state — they are not moved to any other state — and the pre-flight check must refuse to release them until the new template version is `APPROVED` for the exact language being sent, or the operator cancels the campaign. If, at fire time, the new version is `REJECTED`, `PAUSED` or `DISABLED` rather than merely awaiting review, the campaign moves to `failed` instead of remaining `scheduled` (see §12 Campaigns). Campaigns already `running` at the moment of the edit continue on their released snapshot and are unaffected.

**TP-38** A campaign always resolves to a specific template version id at release. If a template has been edited since the campaign was scheduled, pre-flight must resolve to the newest `APPROVED` version and show the operator which version will be used; if no approved version exists, pre-flight refuses release under TP-37.

**TP-39** Template edits, submissions, approvals, rejections, category changes, pauses, unpauses and deletions must all be audit-logged with actor, timestamp, template version id and the affected campaign list where TP-36 applied.

---

## 12. Campaigns

### 12.1 What a campaign is

A campaign is one instruction to send one template to one resolved list of contacts, from one sender number, on behalf of one client. It is the unit of approval, the unit of cost attribution (see §17) and the unit of reporting (see §15). The sending engine that executes it is described in §13; this section defines the object, its states, and the screens that produce it.

**CP-1.** The system must store the following fields on every campaign. Fields marked *frozen* must never change after the campaign leaves `draft`.

| Field | Notes |
|---|---|
| Client (workspace) | Owning client organisation; determines time zone and cost attribution |
| Sender number | One of that client's numbers (see §7) |
| Campaign name | Free text, unique per client |
| Campaign type | From the configurable list in §12.9; drives defaults only |
| Template + language | Owned by the client and resident on exactly one WABA; usable by any sender number attached to that WABA |
| **Template version** *(frozen at launch)* | The specific template version identifier used; this is what the send outbox key records, never the mutable template id |
| **Template content snapshot** *(frozen)* | Full body, header, footer, buttons and category exactly as they stood at launch |
| Audience definition | The contact group, saved segment, uploaded list or manual selection used |
| **Audience snapshot** *(frozen)* | The concrete resolved recipient list, with per-contact variable values and per-recipient click token |
| Variable mapping | Which contact field or literal fills each template parameter, plus per-parameter fallback |
| **Send path** *(frozen)* | `cloud_api` or `marketing_messages` — see CP-3 |
| Optimization spec | Nullable. Reserved for max-price bidding; unused in v1 (CP-4) |
| Schedule time + time zone | Stored in UTC, always displayed in the client workspace time zone |
| Batch size, inter-batch delay | Defaults from campaign type, overridable |
| **Auto-pause thresholds snapshot** *(frozen)* | The circuit-breaker settings in force for this campaign |
| Rate-card version used | The effective date of the rate card behind the cost estimate |
| Status | See §12.2 |
| Approval fields | Approval-requested-by, approval-requested-at, approved-by, approved-at, approval-note — see §12.3 |
| Created by / created at / started at / completed at | Audit fields (see §18) |

**CP-2.** The system must never mutate a launched campaign's template snapshot or audience snapshot. If Meta recategorises or edits the template afterwards, reporting for this campaign must still describe what was actually sent.

**CP-3.** Every campaign must carry a send-path discriminator from the first database migration, with the two values `cloud_api` and `marketing_messages`. In v1 all campaigns use `cloud_api`. This exists because max-price bidding for marketing is only available through Meta's separate Marketing Messages API endpoint — a template with a max price sent to the ordinary Cloud API send endpoint is rejected — and Meta's published timeline makes max-price bidding required in eligible geographies in Q2 2027. Retrofitting a send path later touches every campaign, send and report row.

**CP-4.** The optimization spec field must be nullable and unused in v1. If it is ever populated, it must use Meta's `optimization_spec` shape, never the older `bid_spec`, which Meta ended support for on 2026-07-31. **[Verify before build]** Whether India is an eligible geography for max-price bidding, and whether MM Lite onboarding must be performed per WABA in Business Manager, are unconfirmed.

### 12.2 Statuses and transitions

**CP-5.** Campaign status must be exactly one of these eleven values: `draft` · `pending_approval` · `queued` · `scheduled` · `running` · `paused` · `completed` · `partially_delivered` · `stopped_by_meta` · `failed` · `cancelled`.

Two of these exist because of how Meta actually behaves. Meta applies *template pacing* and *business portfolio pacing*: an initial set of messages goes out, and the remainder is held pending quality feedback and may be released, or dropped outright (error 132015 for a template-pacing kill, 135000 for a portfolio-pacing drop). A campaign can therefore end with most of its list never sent, through no fault of ours.

- **`partially_delivered`** — the campaign finished, but a material share of recipients were never sent, or ended in `held_for_quality_assessment` limbo.
- **`stopped_by_meta`** — Meta explicitly dropped the remainder (132015 or 135000), or paused/disabled the template mid-run.

There is no `halted` state and no `blocked_by_client_status` state. A campaign belonging to a client whose status is `suspended` stays `scheduled` and is refused at pre-flight (see CP-17).

| From | To | Trigger | Who |
|---|---|---|---|
| `draft` | `pending_approval` | Submitted with recipient count at or above the campaign approval threshold | Campaign Manager or above |
| `draft` | `queued` | Launch or Schedule submitted, below the approval threshold | Campaign Manager or above |
| `pending_approval` | `queued` | Approval granted | Client Admin or Super Admin |
| `pending_approval` | `draft` | Approval refused, or request withdrawn | Client Admin or Super Admin (refuse); requesting Campaign Manager (withdraw) |
| `pending_approval` | `cancelled` | Cancelled while awaiting approval | Campaign Manager or above |
| `queued` | `scheduled` | Audience resolved, future start time | System |
| `queued` | `running` | Audience resolved, immediate start | System |
| `queued` | `failed` | Resolution error, zero valid recipients | System |
| `scheduled` | `running` | Start time reached, pre-flight re-check passes | System |
| `scheduled` | `draft` | Un-schedule | Campaign Manager or above |
| `scheduled` | `cancelled` | Cancel before firing | Campaign Manager or above |
| `scheduled` | `failed` | Pre-flight re-check fails at fire time | System |
| `running` | `paused` | Manual pause, or auto-pause circuit breaker | Campaign Manager or above, or System |
| `running` | `stopped_by_meta` | 132015 / 135000 / template PAUSED or DISABLED | System only |
| `running` | `completed` | All recipients reached a terminal status | System |
| `running` | `partially_delivered` | Finished with unsent or held remainder | System |
| `running` | `failed` | Circuit breaker tripped on a non-Meta cause, such as the batch failure rate breaching its configured ceiling | System |
| `running` | `cancelled` | Manual stop | Campaign Manager or above |
| `paused` | `running` | Resume | Campaign Manager or above |
| `paused` | `cancelled` | Abandon remainder | Campaign Manager or above |
| Any terminal | — | No transitions out; clone instead | — |

**CP-6.** Only the system may set `stopped_by_meta`, `partially_delivered`, `completed` or `failed`. Only a human may set `cancelled`. Both may set `paused`. Only a Client Admin or Super Admin may move a campaign out of `pending_approval` by approving it.

**CP-7.** `completed`, `partially_delivered`, `stopped_by_meta`, `failed` and `cancelled` are terminal. A terminal campaign must never resume; the user must clone it (see §12.9).

### 12.3 The campaign approval workflow

**CP-32.** A campaign whose final recipient count is at or above the **campaign approval threshold** must enter `pending_approval` when submitted, instead of `queued`. It may only proceed to `queued`, and thence to `scheduled` or `running`, once approved. The threshold is a per-workspace setting with a platform-wide default of **1,000 recipients**, and is CITS product policy, not a Meta rule. It must never be configurable below the typed-confirmation threshold (see CP-16).

**CP-33.** The recipient count that is tested against the approval threshold is the final recipient count shown on the pre-flight summary — after de-duplication, opt-out, suppression and frequency-governor exclusions — not the raw selected count.

**CP-34.** On submission into `pending_approval` the system must record approval-requested-by and approval-requested-at on the campaign, and must notify every Client Admin in the workspace, plus Super Admins if the workspace has no active Client Admin. The request and the eventual decision must both be audit-logged (see §18).

**CP-35.** Only a Client Admin in the owning workspace, or a Super Admin, may approve or refuse. A user must never approve a campaign they submitted, even where that user holds Client Admin or Super Admin. If a Client Admin creates a campaign above the threshold, it must be approved by a different Client Admin or by a Super Admin.

**CP-36.** An approval decision must record approved-by, approved-at and a free-text approval-note. The note is optional on approval and mandatory on refusal.

**CP-37.** On refusal the campaign returns to `draft` with its refusal note attached and visible on the campaign screen. The submitter is notified. The campaign may be edited and resubmitted; resubmission clears approved-by and approved-at and writes a fresh approval-requested-by and approval-requested-at, and the earlier request and refusal remain in the audit log.

**CP-38.** While a campaign is in `pending_approval` its content is locked in the same way as a scheduled campaign: template, audience definition, variable mapping and schedule may not be edited without first withdrawing the request, which returns it to `draft`.

**CP-39.** If a campaign's scheduled start time passes while it is still `pending_approval`, the system must not fire it and must not silently discard it. It remains `pending_approval`, the campaign screen shows "scheduled start time has passed — awaiting approval", and the submitter and all Client Admins are notified. On approval after the start time has passed, the approver must be shown the lapsed schedule and asked to choose between sending now and picking a new start time; the system must never send at a lapsed time without that choice being made.

**CP-40.** A campaign that remains `pending_approval` for more than seven days raises a reminder notification to the Client Admins and to the submitter. It is never auto-approved and never auto-cancelled.

### 12.4 Audience definition versus audience snapshot

An **audience definition** is the reusable thing the user picked: a contact group (static, explicit membership), a saved segment (a stored filter definition, resolved at the moment it is used), an uploaded list or a manual selection. A campaign stores the definition for provenance, but it sends to a **snapshot**: the concrete list, resolved once, at the moment the campaign is queued, with every variable value already computed per contact.

**CP-8.** The system must resolve the audience into a frozen snapshot before the campaign enters `scheduled` or `running`, and must record, per excluded contact, the reason for exclusion. Where the definition is a saved segment, resolution happens at this moment and the resulting membership is what is frozen.

**CP-9.** The system must re-check consent, suppression, the CITS frequency governor and deliverability state for each recipient immediately before that recipient's message is handed to the sending engine, not only at snapshot time. A contact who opts out between scheduling and sending must never receive the message. Suppression rules and their precedence are owned by §10.

**CP-10.** Where the re-check drops recipients, the campaign report must show snapshot count, sent count and the difference, broken down by reason. A silent shrink is a defect.

**CP-41.** At audience-snapshot time the system must generate a unique per-recipient click token for every recipient of a campaign whose template carries a URL button with a variable component, and must write that token into the recipient's stored resolved template parameter values as the trailing URL-button variable. The sending engine sends exactly the parameter values held on the snapshot row and performs no token generation of its own. A campaign whose template has a variable URL button must fail resolution — and move to `failed` — if any recipient row lacks a token. This is the only point at which click tracking (§16) and the sending engine (§13) are wired together.

### 12.5 The creation wizard

**CP-11.** The system must implement campaign creation as an ordered wizard. Each step must block progress until it is valid.

1. **Choose client.** Only workspaces the user has a role in (see §6). Clients whose status is `suspended` or `archived` may be opened for reading but campaigns may not be submitted for them.
2. **Choose sender number.** Only numbers belonging to that client whose status is Connected. Restricted or unregistered numbers are shown greyed with the reason.
3. **Choose template.** Only templates on that client's WABA, in the exact language being sent. Selectability is defined in CP-42.
4. **Choose audience.** A contact group, a saved segment, an uploaded list or a manual selection. Live count updates as filters change.
5. **Fill template variables.** Map each parameter to a contact field or a literal, with a fallback value per parameter. A variable URL-button parameter is filled by the system with the per-recipient click token (CP-41) and is not user-mappable.
6. **Preview messages.** Render the message exactly as WhatsApp will show it, for at least five real contacts drawn from the audience, including buttons.
7. **Send test message.** See §12.7.
8. **Review recipient count.**
9. **Review excluded contacts** — a downloadable list, grouped by reason.
10. **Choose sending speed.** Batch size and inter-batch delay, with the campaign type's default preselected and a plain-English description of what the setting means.
11. **Send now or schedule.**
12. **Confirm** — the pre-flight summary, §12.6.

**CP-42.** Template selectability in step 3 must be:

| Template status | Behaviour |
|---|---|
| `APPROVED` for the exact language being sent | Selectable. |
| `PENDING` | Selectable **only** for a campaign with a future scheduled start time, and only with a persistent warning stating that pre-flight will refuse to release the campaign if approval has not landed by the start time. Not selectable for a send-now campaign. |
| `PAUSED` | Visible, unselectable; show the reason and the remaining pause time. |
| `DISABLED` | Visible, unselectable; show the reason. |
| `REJECTED` | Visible, unselectable; show the rejection reason. |

The wizard's leniency toward `PENDING` templates is deliberate and is not a loosening of the send rule: the sending engine (§13) must refuse to release any message whose template is not `APPROVED` for the exact language being sent.

### 12.6 The pre-flight summary

This is the most important screen in the product. It is the last point at which a mistake is cheap.

**CP-12.** The confirmation screen must display, on one page: total selected contacts; invalid numbers removed; duplicates removed; the itemised exclusion breakdown required by CP-43; the final recipient count; the message category Meta will most likely assign; the estimated cost; the batch size and inter-batch delay; the start time in the client's time zone; the sender number with its current quality rating; the number of unique recipients still available today against the shared portfolio cap; and, where the count is at or above the campaign approval threshold, a statement that submitting will request approval rather than launch.

**CP-43.** Exclusions must be itemised by reason, never rolled into one number. At minimum, and each on its own line with its own count and its own downloadable list:

- opted out;
- on a suppression list (§10);
- **blocked by the CITS frequency governor** — the per-contact ceiling on marketing messages per rolling period, configurable per client and platform-wide, suggested default 4 per 30 days per client. This is CITS product policy and is entirely independent of Meta's own per-user marketing frequency cap; the two must never be presented as one number;
- deliverability state `invalid` (syntactic failure);
- duplicate within the selected list;
- missing a required variable value with no fallback.

**CP-13.** The cost figure must be labelled **[Estimate only]** and must state the effective date of the rate card used and that 18% GST applies on top. Meta charges per *delivered* template message, and India rates in the fact base are transcribed from secondary sources — **[Verify before build]** confirm the INR rate card in Business Manager before the first estimate is shown to anyone.

**CP-14.** The screen must state that the daily unique-recipient cap is pooled across every client in the CITS business portfolio, because Meta has calculated messaging limits at business-portfolio level since 2025-10-07. One client's campaign consumes headroom that another client's campaign then cannot use. The screen must show remaining headroom as a number, not a percentage. The screen must also read the rolling-365-day portfolio template-message count as live data: portfolio pacing applies below 500,000 template messages in a rolling 365 days, and at CITS's year-one ceiling of just under 50,000 a month the portfolio sits inside that regime for roughly the first ten months, so portfolio pacing is the default state in year one rather than an edge case.

**CP-15.** If the recipient count exceeds remaining portfolio daily headroom the system must **block launch** — not warn. The blocking message must state how many recipients cannot be reached today, and must offer splitting the campaign across days as the only path forward. There must be no override, no "send anyway" and no acknowledgement checkbox that dismisses it.

**CP-16.** Above the **typed-confirmation threshold** — a per-workspace setting with a platform-wide default of **500 recipients**, CITS product policy — launch must require the user to type the campaign name exactly. A checkbox is not sufficient. At or below the threshold, a single confirm click is sufficient. This threshold is separate from, and always lower than or equal to, the campaign approval threshold of CP-32 (default 1,000): between 500 and 999 recipients the user types the name and launches; at 1,000 and above the user types the name and the submission then goes to a Client Admin or Super Admin for approval.

**CP-17.** The system must block launch outright — not warn — when any of the following hold, and must name the specific blocker:

| Blocker | Detection |
|---|---|
| Template not `APPROVED` for the exact language being sent | Template status at fire time |
| Template `PAUSED`, `DISABLED` or `REJECTED` | Template status; show remaining pause time where applicable |
| **Template edited since the campaign was scheduled** | Template version identifier on the campaign no longer matches the current approved version; the edit must be treated as a blocker because the approved content the operator reviewed is not the content that would now be sent |
| Template recategorised since scheduling | Category on the current version differs from the frozen snapshot |
| Sender number not Connected, or Restricted | Phone number status |
| **Client status is `suspended`** | Client record; the campaign stays `scheduled` and is refused here rather than moving to any blocked state |
| Zero valid recipients after exclusions | Snapshot count |
| A parameter has no value for at least one recipient and no fallback | Variable mapping check |
| A recipient row is missing its click token where the template has a variable URL button | Snapshot integrity check (CP-41) |
| Marketing template with any recipient on a +1 number with a US area code | Meta does not deliver marketing templates to US numbers; Canada and Caribbean +1 numbers must never be blocked (see §2) |
| Recipient count exceeds remaining portfolio daily headroom | Portfolio headroom (CP-15) |
| Campaign is at or above the approval threshold and is not approved | Campaign status and approval fields |
| Payment method problem on the account (error 131042) | Last known account state; this blocks all sending |

**CP-18.** Blockers must be evaluated twice: when the confirm screen is rendered, and again immediately before a scheduled campaign fires. A campaign that fails the second evaluation must move to `failed` with the blocker recorded, and must notify the workspace's Client Admins and the campaign's creator (see §18). There are three exceptions, where the campaign is refused at pre-flight rather than failing: client suspension, where it remains `scheduled`; pending approval, where it remains `pending_approval`; and a template not yet `APPROVED` — still `PENDING`, or awaiting re-approval after an edit — where it remains `scheduled` (matching §11). By contrast, a template that is `REJECTED`, `PAUSED` or `DISABLED` is not a wait-and-retry case and does move the campaign to `failed`.

### 12.7 Test sends

**CP-19.** Each client workspace must hold a configurable list of internal test numbers. A test send must use the real template, the real sender number and real variable values pulled from a chosen contact in the audience — never placeholder text. Test sends must use a distinct test click token and must never consume a recipient's real token.

**CP-20.** The delivery status of each test message must be shown on the wizard screen as it arrives, including failure codes in plain English, resolved through the (api_surface, code) classification table of §13 rather than by code alone.

**CP-21.** The system must require at least one test send that reached `delivered` before a given template version is used in its first launched campaign on a given sender number. Subsequent campaigns using the same template version and number may skip it. This is CITS product policy, not a Meta rule.

### 12.8 Scheduling

**CP-22.** All scheduling must be expressed in the client workspace time zone. Server time must never appear in the interface. Stored times must be UTC.

**CP-23.** The system must support client-configurable quiet hours, expressed in the client's time zone. Quiet hours are entirely opt-in: a workspace has none until quiet-hour rows are configured for it, and there is no seeded default. Where a workspace has configured quiet hours, a campaign scheduled to start inside them must be blocked, and a running campaign that reaches quiet hours must pause and resume at the next permitted time. This is entirely CITS product policy — **Meta publishes no quiet-hours rule** — and clients may configure, widen or narrow their quiet hours, or leave them unset.

**CP-24.** If, between scheduling and firing, the template is rejected, paused, disabled, edited or recategorised, or the sender number becomes Restricted, the system must not fire. It must move the campaign to `failed`, record the exact cause, and notify. A recategorisation from Utility to Marketing must be treated as a blocker rather than a warning, because it changes both the cost and whether US recipients are deliverable. Meta runs utility-to-marketing recategorisation continuously, sometimes with no advance notice, so this check cannot be skipped for "recently verified" templates.

### 12.9 Campaign types, duplication and re-runs

**CP-25.** Campaign type must be a configurable list per client, seeded with: conference website launch, abstract submission reminder, final deadline reminder, journal article notice, membership renewal, election and voting notification, annual general meeting, payment reminder, society announcement, product update, lead follow-up. The type must only set defaults — suggested template category, batch size, inter-batch delay, auto-pause thresholds. No sending behaviour may be hardcoded against a type.

**CP-26.** Any campaign must be clonable into a new `draft`, copying the template, variable mapping, speed settings and audience *definition* — never the audience snapshot and never the click tokens. A clone carries no approval fields; if it is above the approval threshold it must be approved on its own merits.

**CP-27.** The system must support re-targeting from a completed campaign, generating a new audience from recipients of the original whose message was: not delivered, delivered but not read, or read but not clicked. Read and click data must be captured within seven days of the original send, because Meta's template analytics stop exposing it after that; any rate whose numerator was never captured inside that window renders as **"not captured"**, never as zero (see §15).

**CP-28.** Re-target campaigns must go through the full pre-flight, including consent re-check, frequency-governor check and, where applicable, approval. A contact who opted out after the first campaign must never appear in the follow-up.

**CP-44.** An operator-initiated retry of a specific recipient set does not create a new campaign. It creates new send rows in the same campaign under `attempt_key` + 1, and appears in the same campaign report as a separate attempt. Automatic retries inside the error-handling policy of §13 reuse the same `attempt_key` and are therefore idempotent.

### 12.10 Interruptibility

**CP-29.** Every campaign must be designed so that the first batch is independently useful. Content that only makes sense if the whole list receives it — for example a message whose value depends on simultaneous delivery — must not be written as a single campaign.

**CP-30.** The campaign detail screen must distinguish four states per recipient, in plain language, and must never collapse them into a single "pending" count:

- **Not sent yet** — waiting in our queue.
- **Held by Meta** — Meta accepted the request and returned `held_for_quality_assessment`. Not sent, not failed, not retryable.
- **Dropped by Meta** — Meta terminated it (132015 or 135000). Never delivered, never charged, will not retry.
- **Sent** — Meta accepted and issued a message ID; delivery is then tracked separately.

**CP-31.** When a campaign is `stopped_by_meta`, the screen must state in one sentence what happened, how many recipients were affected, and what the operator should do next. Detailed retry and backoff behaviour belongs to §13; the campaign screen's job is to make the situation legible to a non-technical account manager at a scientific society.

**CP-45.** Campaign counts on this screen must use the canonical rate definitions of §15: failure rate is failed ÷ final recipients, and messages blocked by Meta's per-user marketing frequency cap (error 131049) or dropped by Meta's pacing must never be summed into it. Where a non-delivery rate is shown it must be displayed with its three components — failed, dropped by pacing, blocked by frequency cap — itemised.

### 12.11 Mobile behaviour

**CP-46.** The campaign list, the campaign detail screen and the approve/refuse decision on a `pending_approval` campaign are **mobile-critical** and must be fully operable at 375px width — a Client Admin must be able to approve a campaign from a phone. The pre-flight summary is **mobile-usable**: fully readable and navigable at 375px, with launch confirmation deferred to a larger screen. The creation wizard is **desktop-first** and must degrade to a legible read-only view plus a "best used on a larger screen" notice, never a broken layout.

---

## 13. Sending engine

### 13.1 What the sending engine is

The sending engine takes an approved campaign and turns it into individual messages delivered to WhatsApp, at a pace that keeps CITS inside four separate Meta limits, that reacts within seconds when Meta signals trouble, and that never sends the same message to the same person twice. It is the only part of the product that spends money, and the only part that can get a client's number restricted.

**SE-1.** The sending engine must be the single path through which any outbound WhatsApp message leaves the system. No screen, script or job may call Meta's send endpoint directly.

**SE-1a.** The sending engine must refuse to release any message whose template is not `APPROVED` for the exact language being sent, even where the campaign was legitimately created and scheduled against a `PENDING` template. The refusal is recorded against the campaign, surfaced to the operator, and does not consume an `attempt_key`.

**SE-1b.** The sending engine must refuse, at pre-flight, to release any message for a client whose status is `suspended` or `archived`. The campaign remains in state `scheduled` — there is no separate blocked state — and the refusal reason is shown on the campaign and raised as a notification.

**SE-1c.** The sending engine must refuse to release a message for a campaign that is in state `pending_approval`. A campaign at or above the campaign approval threshold reaches `scheduled` or `running` only after approval by a **Client Admin** or **Super Admin** (see §12 Campaigns).

### 13.2 The batch ramp (CITS policy, not a Meta rule)

Every campaign runs as an ordered sequence of batches rather than one blast. The operator sees each batch complete, with its delivery and failure numbers, before the next one is released.

**SE-2.** Every campaign must execute in ordered batches. The default ramp for a template being used for the first time is:

| Batch | Size | Gate before the next batch |
|---|---|---|
| 0 — Test send | Up to 10 internal CITS numbers | Manual operator confirmation that the message rendered correctly |
| 1 — Seed | 50 recipients (or 2% of the audience, whichever is larger) | Automatic hold until 90% of batch 1 has reached a terminal status, or 30 minutes elapse; then operator confirmation |
| 2 — Probe | 250 recipients | Automatic gates only (see §13.8 circuit breakers) |
| 3 — Expand | 1,000 recipients | Automatic gates only |
| 4..n — Remainder | Up to the per-batch ceiling derived from remaining portfolio headroom | Automatic gates only |

**These numbers are CITS product policy. Meta publishes no batch sizes and no ramp schedule.** All of the "week 1: 10–20 messages per day, week 2: 30–50 per day" warm-up schedules circulating on vendor and BSP blogs have **no Meta source whatsoever**, and two changes on 2025-10-07 made them structurally obsolete: messaging limits moved from the phone number to the business portfolio (so a new number inherits the portfolio's tier — there is no per-number ramp to perform), and the "Flagged" number state was removed so a quality drop no longer downgrades a messaging limit. CITS does not use those schedules.

**SE-3.** All batch sizes and gate thresholds must be stored as per-workspace configuration, editable without a deploy, with the table above as the platform-wide default.

**SE-4.** Batch 1 of every campaign must be independently useful. Meta's template pacing and portfolio pacing mechanisms can silently withhold or permanently drop everything after batch 1, so a campaign must never depend on later batches for its message to make sense.

### 13.3 The ramp policy Meta's rules actually justify

Meta publishes exactly two rules that affect how fast the messaging limit grows, and the scheduler is derived from those and nothing else.

- **Leaving the 250 tier** requires either Meta business verification, partner-led verification, or delivering 2,000 messages outside service windows to unique users within a rolling 30 days using high-quality-rated templates. **CITS's portfolio business verification is already approved**, so CITS starts above 250 and this path is not on the critical path.
- **Above 2,000**, the tier upgrades automatically — typically within about 6 hours — when messages are high quality across all numbers and templates **and at least 50% of the current limit was used in the last 7 days**.

The second rule is the whole scheduling policy. Sending a trickle never earns an upgrade, because the 50% utilisation condition is never met. Sending to 100% of the cap earns nothing extra over 50% and increases quality risk.

**SE-5.** The scheduler must target sustained utilisation of **55–70% of the current portfolio messaging limit measured across a rolling 7 days** (CITS product policy). When planned volume falls below 55%, the system must surface a "ramp stalled — limit will not upgrade" notice on the dashboard. When planned volume would exceed 70%, the system must warn before launch and require confirmation.

**SE-6.** The system must never plan a 24-hour send volume that exceeds the portfolio's current unique-recipient limit minus recipients already consumed in the rolling window by any other client.

**SE-7.** Because messaging limits and quality are pooled at the **business portfolio** level and CITS owns the portfolio, one client's campaign consumes headroom belonging to all clients, and one client's poor quality is felt by all. Every headroom display must show portfolio-wide consumption, not just the current client's. This is the accepted cost of the CITS-owns-everything model (see §5 Multi-client management).

**SE-7a.** If a campaign's recipient count exceeds the remaining portfolio daily headroom, the system must **block launch** — not merely warn. The message must state how many recipients cannot be reached today and offer splitting the campaign across days as the only path forward.

**SE-7b.** Portfolio pacing applies below **500,000 template messages in a rolling 365 days**. At CITS's year-one ceiling of just under 50,000 a month the portfolio sits inside that regime for roughly the first ten months, and exits only if that volume is sustained — so portfolio pacing is the **default** state in year one. The rolling-365-day count must be read as live data on every pre-flight, never assumed from a static configuration value.

### 13.4 The four throttles

These are four independent limits. Each has its own error code, its own limiter, and its own backoff. Passing one does not exempt you from the others.

| # | Throttle | Scope | Value | Error (api_surface, code) | Handling |
|---|---|---|---|---|---|
| 1 | Unique-recipient cap per rolling 24 hours, outside service windows | **Business portfolio** | 250 / 2,000 / 10,000 / 100,000 / Unlimited | none (limit hit puts the number into Restricted state) | Outer bound on the scheduler. Modelled on the portfolio entity, never on the phone number. Refreshed from the messaging-limit field and the `business_capability_update` and `account_alerts` webhooks |
| 2 | Throughput, messages per second | Per phone number | 80 default; **20 if coexistence**; 1,000 if auto-upgraded | (`/messages`, 130429) — throughput ceiling. The same code on `/block_users` means request rate limit and is a different row in the table | Read live via the phone number's `throughput` field and drive a token bucket from that value. Never hardcode 80. On 130429 from `/messages`, halve the bucket rate and recover gradually |
| 3 | Pair pacer — messages to the same person | Per (sender number, recipient) | About **1 message per 6 seconds** — **[Verify before build]**: Meta's dedicated rate-limits page could not be retrieved, so this figure is low confidence and must be confirmed before load testing | (`/messages`, 131056) | A per-recipient limiter. A single global limiter is not sufficient. Backoff is per recipient; Meta suggests a 4-to-the-power-of-attempt seconds delay |
| 4 | Graph API call rate | Per app per WABA | Reported as 200 requests/hour on an inactive WABA, 5,000/hour active — **[Verify before build]**, medium confidence | (`graph`, 4) app-level, (`graph`, 80007) WABA-level | Global request limiter shared by sending, template management and analytics polling. Exponential backoff with jitter |

**SE-8.** The system must implement all four limiters separately and must not send when any one of them is exhausted.

**SE-9.** Throughput must be read from Meta at worker start and refreshed at a configurable interval and on every `phone_number_quality_update` webhook, since that webhook now also fires for throughput changes.

**SE-10.** The operator UI must always name **which throttle is currently binding**.

**SE-10a.** Independently of Meta's per-user cap, the pre-send suppression check must enforce the **CITS-side frequency governor**: a configurable per-contact ceiling on marketing messages per rolling period, set per client and platform-wide (CITS product policy; suggested default 4 per 30 days per client). Suppressions by the governor must appear in the pre-flight summary as their own named exclusion reason and must never be reported as failures.

### 13.5 Pause, resume, cancel

**SE-11.** Pause, resume and cancel must take effect within **10 seconds** of the operator clicking, not at the end of the current batch.

**SE-12.** On pause (campaign state `paused`): no new send jobs start; jobs already in flight with Meta run to completion and their outcomes are recorded normally; queued jobs remain queued; scheduled batches stop advancing.

**SE-13.** On resume: the campaign returns to `running` and continues from the next unsent recipient. Recipients already accepted by Meta must never be re-enqueued.

**SE-14.** On cancel (campaign state `cancelled`): all remaining queued jobs for that campaign are removed; in-flight jobs still complete and are recorded. Cancellation is final — a cancelled campaign cannot be resumed, only cloned.

**SE-15.** Messages already delivered before a cancel remain fully tracked and **remain attributed to the client for cost purposes** (see §17 Usage and cost tracking). Cancelling a campaign does not un-spend money.

**SE-16.** Cancel and pause must both be recorded in the audit log with actor, timestamp and the campaign's state at the moment of the action.

### 13.6 Retry policy

**SE-17.** Retry behaviour must be driven by an error-classification table stored **in the database as data**, seeded from Appendix A and editable by a Super Admin without a code deploy. The table is keyed on **(api_surface, code)**, never on code alone, because Meta reuses codes across endpoints with different meanings — for example 131047 means "customer service window expired" on `/messages` but "target has not messaged in 24 hours" on `/block_users`, 130429 means throughput ceiling on `/messages` but request rate limit on `/block_users`, and 131021 means sender equals recipient on `/messages` but self-block on `/block_users`. The engine branches on the JSON `code` field together with the API surface that produced it, never on the HTTP status, because Meta does not populate meaningful HTTP statuses for most WhatsApp errors.

**Five classes, and no others:**

- **`RETRY_BACKOFF`** — transient. Exponential backoff with jitter, bounded attempt count, all inside the same `attempt_key`. Covers (`graph`, 4), (`graph`, 80007), (`/messages`, 130429), (`/messages`, 131056) with per-recipient backoff, (`/messages`, 131057) throughput upgrade in progress — retry after about a minute, plus (`/messages`, 2), 131016, 133004 and 131000.
- **`TERMINAL`** — never retried automatically and never offered for operator retry; the recipient is marked failed with a human-readable reason. Covers template and parameter errors, policy violations, opt-outs and pacing drops.
- **`CONDITIONAL`** — the send cannot succeed as submitted, but could succeed later or with a changed input. The engine never retries these automatically; it records a named condition that must clear first (a service window reopening, a frequency period elapsing, an approved template being substituted, a corrected parameter). Once the operator can show the condition has changed, the recipient becomes eligible for an operator-initiated retry under a new `attempt_key`. Covers (`/messages`, 131047) window expired, (`/messages`, 131049) per-user marketing cap, and parameter-mismatch errors that a template-version change resolves.
- **`PROBABLE_INVALID_CONTACT`** — (`/messages`, 131026) only. Feeds the strike rule in SE-18. Never automatically retried, and not offered for operator retry while a strike is open.
- **`OPERATIONAL_ALERT`** — sending stops and a human is paged. Covers (`/messages`, 131042) payment method problem, which blocks all sending; (`graph`, 368), (`/messages`, 130497), (`/messages`, 131031) for restriction, country restriction and account lock; (`graph`, 190), (`graph`, 0), (`graph`, 200) for token or auth failure; and (`/messages`, 131045), (`/messages`, 133010) for number not registered. Recipients failed under this class become eligible for operator retry once the underlying cause is cleared.

**SE-18.** **(`/messages`, 131026) — probable invalid contact.** This code is overloaded: it also fires for out-of-date WhatsApp clients, unaccepted terms, and Meta declining on policy grounds. Delivery evidence must therefore **never** set a contact's deliverability state to `invalid` — `invalid` is reserved for syntactic validation failure only. A 131026 records a strike, and the contact moves from `unknown` or `deliverable` to **`suspect`** only after **N** occurrences across at least **M** distinct campaigns and at least **D** distinct calendar days (CITS product policy; defaults N=3, M=2, D=2, all configurable per workspace). The transition to `suspect` must be operator-reversible and audit-logged.

Three cases where a naive retry causes real damage, and which must be special-cased explicitly:

**SE-19.** **(`/messages`, 131049) — per-user marketing cap.** Classified `CONDITIONAL`; never retried automatically. Meta states that excessive retries may make further delivery to that user unavailable for up to 24 hours. It is reported as **"blocked by frequency cap,"** a first-class campaign metric, and is counted in the non-delivery rate as its own itemised component — it must **never** be summed into the failure rate. Meta deliberately publishes no number for this cap, so the system must not display or assume any number for it. This is distinct from the CITS-side frequency governor in SE-10a, which is CITS product policy and does have a configurable number.

**SE-20.** **(`graph`, 133016) — registration/deregistration attempt limit.** Registration and deregistration are **two independent counters**, each capped at **10 attempts per number per rolling 72 hours**. A change of data-localization region consumes one attempt from **each** counter. The system must maintain both counters itself and must:
- refuse the **eighth** attempt in either counter unless an operator supplies an explicit typed confirmation, recorded in the audit log with the counter name and its current value;
- refuse the **eleventh** attempt in either counter **unconditionally**, with no override path;
- never place registration or deregistration calls inside an automatic retry loop.

**SE-21.** **(`/messages`, 131047) — 24-hour customer service window expired.** Classified `CONDITIONAL`; never retried automatically. The system must instead offer the operator an approved template. Better still, the composer must hard-block free-form sending once the window is closed rather than letting the send fail (see §14 Inbox). Note that 131047 on `/block_users` is a different condition entirely and must be classified separately.

#### Operator-initiated retry

**SE-43.** **`attempt_key` is an integer starting at 1**, carried on every send outbox row. It is incremented **only** by an explicit operator-initiated retry of a specific recipient set. Every automatic retry performed inside the error-handling policy — all `RETRY_BACKOFF` behaviour, all stalled-job recovery — reuses the same `attempt_key` and is therefore idempotent against the outbox uniqueness constraint in SE-30.

**SE-44.** A "retry eligible failures" action must exist on a finished campaign. It is available to a **Campaign Manager**, **Client Admin** or **Super Admin**, never to an **Inbox Agent** or **Viewer**. Rules:
- Eligible recipients are those whose last outcome was classified `RETRY_BACKOFF` (attempts exhausted), `CONDITIONAL` (with the named condition now clear), or `OPERATIONAL_ALERT` (with the underlying cause resolved). Recipients whose last outcome was `TERMINAL` or `PROBABLE_INVALID_CONTACT` are never offered.
- The retry creates **new outbox rows in the same campaign** under `attempt_key + 1`. It never mutates the original rows, and it never creates a second campaign.
- The retry runs through the full pre-send path unchanged: suppression, consent, CITS frequency governor, portfolio headroom, template-status gate, and all four throttles.
- The retry re-uses the template version recorded on the campaign unless the operator explicitly selects a newer approved version, in which case the new `template_version_id` is recorded on the new rows.
- The action is audit-logged with actor, recipient count, new `attempt_key`, and the eligibility filter used.

**SE-45.** Retried recipients must appear **in the same campaign report as a separate attempt**. The report shows per-attempt counts and a combined total, and states plainly which attempt produced each final outcome. Failure rate and non-delivery rate are shown per attempt and for the campaign as a whole; the denominator in both cases is final recipients for that attempt.

### 13.7 held_for_quality_assessment

Meta's send response returns a `message_status` of `accepted`, `held_for_quality_assessment` or `paused`. The middle value is a limbo state produced by template pacing: Meta has taken the message but is withholding it pending early quality feedback. It may later be released, or dropped as failed with code 132015.

**SE-22.** `held_for_quality_assessment` must be a distinct message state. It must never be counted as sent, never counted as delivered, never counted for cost, and never retried.

**SE-23.** The operator UI must use plain language for this state: **"Held by Meta for quality checks — not yet delivered. These may be released or may be dropped."** A per-campaign held count and held ratio must be visible.

### 13.8 Automatic circuit breakers

**SE-24.** The engine must hard-stop the remaining sends of a campaign when any of the following occurs:

| Trigger | Source | Resulting campaign state |
|---|---|---|
| Template quality moves to **RED** | `message_template_quality_update` webhook | `stopped_by_meta` |
| Template status moves to **PAUSED** or **DISABLED** | `message_template_status_update` webhook | `stopped_by_meta` |
| Any failed status carrying **132015** (template pacing kill) | statuses webhook | `stopped_by_meta` |
| Any failed status carrying **135000** (portfolio pacing drop — the whole remaining queue is gone) | statuses webhook | `stopped_by_meta` |
| Failure rate within a batch exceeds a configured percentage (**default 10%, CITS product policy**) | computed | `stopped_by_meta` where the cause is a Meta signal; otherwise `failed` |
| An enforcement action arrives | `account_update` webhook | `stopped_by_meta` |
| The phone number leaves `connected` state | `phone_number_quality_update` webhook | `stopped_by_meta` |

**SE-24a.** **Precedence between the batch failure-rate circuit breaker and the 131026 strike rule.** The circuit breaker is evaluated **first**, on the batch's aggregate outcome, before any per-recipient strike is written. If the breaker fires, the campaign stops and **strike recording under SE-18 is suppressed for the entire campaign** — not merely for the remaining batch, and not merely for the batch that tripped it. Strikes already written by earlier batches of the same campaign are rolled back, so that a single misconfigured campaign can never push a population of contacts toward `suspect`. The suppression is recorded on the campaign and shown in the campaign report as "contact deliverability strikes suppressed — campaign stopped by circuit breaker."

**SE-25.** Template quality moving to **YELLOW** must pause (state `paused`, not `cancelled`) a campaign that is past a configured completion percentage (default 25%, CITS product policy) and require operator confirmation to continue.

**SE-26.** **Meta publishes no block-rate, report-rate or read-rate thresholds at all.** Every numeric threshold in this section is CITS product policy, must be labelled as such in the UI, and must be configurable per workspace. In particular, the commonly quoted "a healthy read rate is 65–80%" figure is vendor folklore with no Meta source and must not appear anywhere in the product, its documentation or its alerting logic.

**SE-27.** Every circuit-breaker trip must raise a notification (see §18) naming the trigger, the campaign, the client and the number of recipients not sent.

### 13.9 What the operator sees during a run

**SE-28.** A running campaign must show, refreshing at least every 5 seconds:

- Live counts by state: queued, in flight, accepted, held, sent, delivered, read, failed, blocked by frequency cap (Meta), suppressed by the CITS frequency governor, dropped by pacing, suppressed.
- Current batch number, batch size, and progress within it, and the current `attempt_key` where it is greater than 1.
- **Which throttle is currently binding** — portfolio cap, per-number throughput, pair pacer, Graph API call rate, or none.
- Remaining portfolio unique-recipient headroom for the rolling 24 hours, with the share already consumed by other clients.
- A histogram of error codes with their plain-English meanings, labelled with the API surface each came from.
- Estimated completion time under the current binding throttle.

**SE-28a.** Rates on this screen follow the canonical definitions: **failure rate = failed ÷ final recipients**; **non-delivery rate = (failed + dropped by pacing + blocked by frequency cap) ÷ final recipients**, always displayed with its three components itemised. Any rate whose numerator was never captured inside Meta's 7-day analytics window must render as **"not captured"**, never as zero.

**SE-28b.** Where the viewing user holds **Viewer** without the "View full phone numbers" permission, all recipient numbers on this screen and in the resulting campaign report must be masked to the last 4 digits.

**SE-29.** When Meta is pacing or has dropped the remainder, the UI must display an unambiguous banner, not a subtle status chip. Required wording, by cause: *"Batch 1 released. The remainder is pending Meta's quality assessment and may not be sent."* (held), and *"Meta dropped the remaining N messages of this campaign (portfolio pacing, code 135000). They will not be sent and were not charged."* (dropped).

### 13.10 Queue design

Queues run on BullMQ over Valkey. Five queues, each with its own worker concurrency:

| Queue | Purpose |
|---|---|
| `send` | One job per recipient message. The only queue that calls Meta's send endpoint |
| `webhook-ingest` | Processes raw webhook payloads already acknowledged and persisted by the HTTP receiver |
| `campaign-control` | Batch release, gate evaluation, circuit-breaker evaluation, scheduled campaign launch |
| `reconcile` | Periodic sweeps (see §13.11) |
| `maintenance` | Analytics polling, template status refresh, throughput refresh, token health checks every 6 hours, import processing |

**SE-30.** Every send job must carry a deterministic job ID derived from **(`campaign_id`, `recipient_id`, `template_version_id`, `attempt_key`)**, so that enqueueing the same job twice is a no-op. The same value is written to a send outbox row protected by a unique constraint on exactly those four columns. The key uses the immutable **`template_version_id`**, never the mutable template id, so that editing a template can never collide with or silently re-key existing outbox rows.

**SE-31.** That same identifier must be sent to Meta as `biz_opaque_callback_data` (maximum 512 characters), which Meta echoes on every status webhook. This is the only correlation mechanism available — **Meta provides no idempotency-key header.**

**SE-32.** A message must be marked accepted only after Meta's returned message ID (wamid) has been persisted. On a network timeout with no response, the system must **not** resend; it waits for a status webhook carrying its identifier and backfills the wamid from it.

**SE-33.** All jobs belonging to one campaign must share a BullMQ group keyed on the campaign ID, so the whole campaign can be paused, resumed and drained as a unit. Jobs under a later `attempt_key` join the same group.

**SE-34.** Scheduled campaigns must enqueue a single delayed control job at launch time rather than thousands of delayed send jobs, so that a schedule change is one operation.

**SE-35.** Two configuration rules are mandatory and must be asserted at startup: worker connections must set `maxRetriesPerRequest: null` (blocking commands fail otherwise), and an ioredis `keyPrefix` must never be set (it collides with BullMQ's own prefixing — use BullMQ's `prefix` option instead). Startup must fail loudly if either is violated.

**SE-36.** On worker crash and restart, in-flight jobs are returned to the queue by BullMQ's stalled-job handling. Because job IDs are deterministic and the outbox row carries a unique constraint, and because recovery reuses the same `attempt_key`, a restart **must never produce a second send** for a recipient that already has an accepted row. This must be covered by an automated test that kills a worker mid-batch.

**SE-37.** [Verify before build] The BullMQ Bun adapter is not confirmed production-grade. A time-boxed soak spike must run before architecture freeze; pg-boss is the documented fallback (see §3 Technology stack).

### 13.11 Reconciliation

**SE-38.** A reconciliation sweep must run at a configurable interval (default every 15 minutes) and find every message accepted by Meta that has had no terminal status for longer than **`unresolved_send_age`**, a single platform setting with a default of **6 hours**. That one setting is used identically by this sweep, by the dashboard's unresolved-sends tile and by the unresolved-sends alert — there is no second age value anywhere in the product. For each such message the sweep must: re-check for a late webhook by identifier, mark the message `unresolved` if none is found, count it in an unresolved-wamid metric, and alert when that count crosses a configured threshold. It must never resend an unresolved message.

**SE-39.** Reconciliation must tolerate Meta's webhook behaviour: retries produce duplicates over at least 36 hours (Meta's own documentation gives conflicting figures of 36 hours and 7 days), no ordering is guaranteed, and there is no replay API and no dead-letter queue. Status events are therefore appended to an append-only table and deduplicated on **(`wamid`, `status`) only**. Meta's provider timestamp is stored on the row and used for ordering, but it is **not** part of the dedupe key, so a redelivery carrying a different timestamp is still absorbed as a conflict rather than inserted twice. Current status is derived by monotonic rank, so a message can never regress from read back to delivered.

**SE-40.** Where a message is delivered and read almost simultaneously, Meta may skip the `delivered` webhook entirely; a multi-device user may produce both `delivered` and `failed` for the same message. Delivered to at least one device counts as delivered. Reconciliation must not treat either case as an anomaly.

**SE-41.** **Version caveat for billing reconciliation.** The `conversation` and `pricing` objects appear on `delivered` and `read` status webhooks only in Graph API v23 and below. From v24 onward they appear on those events only for free-entry-point conversations. Cost reconciliation must therefore read pricing off the **`sent`** event and persist it there. Any code reading pricing from a delivered or read webhook is a defect.

### 13.12 Load expectations and what they mean

Year one is under 10 clients and under 50,000 messages per month. That is roughly 1,700 messages per day, or an average of about 0.02 messages per second. Even a worst case in which an entire month's volume is sent in a single hour is under 14 messages per second — well inside the 80-per-second default throughput of a single number.

**SE-42.** The engine must be sized for this reality: a single VPS running one API container, one Next.js container, PostgreSQL, Valkey and a small number of worker processes. Send-queue concurrency must default to a low value (10) and be configurable.

The honest conclusion: **throughput is not the constraint.** Nothing at CITS's scale will be limited by the machine. What limits sending is Meta's portfolio unique-recipient cap, Meta's pacing, and template quality. Engineering effort belongs in correctness — idempotency, error classification keyed on (api_surface, code), circuit breakers, reconciliation — not in horizontal scaling. Nothing described here structurally blocks growth: the same queues, limiters and outbox pattern work unchanged at ten times the volume, and the first thing that would need to change is worker concurrency, which is a configuration value.

---

## 14. Inbox

### 14.1 What the inbox is for

The inbox is the screen where a CITS user reads what a contact sent back and replies to them. It is not a chatbot console and it is not a helpdesk. In v1 it does one job: let a small number of people handle inbound replies from society members, authors, delegates and students, per client, without breaking WhatsApp's rules.

Every inbox object is scoped to one client workspace and one CITS-owned sender number (see §5 Multi-client management, §7 WhatsApp sender numbers). A user must never see another client's conversations.

The workspace roles that touch the inbox are **Client Admin**, **Campaign Manager**, **Inbox Agent** and **Viewer** (see §6 Roles and permissions). **Inbox Agent** is the role built primarily for this screen; **Viewer** has read-only inbox access. **Super Admin** is an application-level role held on the user record and can reach any workspace's inbox for support purposes, with every access audit-logged.

### 14.2 Conversation list

**IB-1** The system must present, per client workspace, a list of conversations — one conversation per pairing of business phone number and WhatsApp user — showing: contact display name (falling back to the WhatsApp profile name, then the E.164 number), phone number, a one-line preview of the most recent message, an unread indicator with unread count, assigned Inbox Agent (or "Unassigned"), conversation state (`open` or `closed`), the campaign that the first inbound reply was attributed to (if any), and the timestamp of the last message.

**IB-2** Each row must show a **24-hour window badge** in one of three display states: **Window open (Xh Ym left)**, **Window closing soon (under 1 hour)**, or **Window closed**. This is a rendering of the messaging window only — it is *not* a conversation state. Conversation state has exactly two values, `open` and `closed` (IB-24), and the two must be shown as visually distinct controls so they are never confused. The badge must be computed from stored data, never from a live API call.

**IB-3** The list must sort by most recent message first by default, with an alternative sort by oldest unanswered message first.

**IB-4** The system must provide search across contact name, phone number (matching on normalised E.164 and on the last 10 digits typed loosely), and message text.

**IB-5** The system must provide these filters, combinable: unread · assigned to me · unassigned · `open` · `closed` · by client workspace · by sender number · by campaign · window open / window closed · opted out. The "opted out" filter exists so a user can see who has unsubscribed and avoid re-engaging them (see §10 Consent and opt-out).

### 14.3 Conversation view

**IB-6** The conversation view must show the full message history in chronological order, sorted by the message `timestamp` field and never by webhook arrival order, de-duplicated on the WhatsApp message ID (wamid). Webhooks arrive at-least-once, out of order, and can be replayed. Status events are de-duplicated on **(wamid, status)** only; the provider timestamp is stored but is not part of the key, so a redelivery carrying a different timestamp is absorbed as a conflict rather than shown twice (see §13 Sending engine).

**IB-7** Outbound messages must show their delivery state using Meta's five status values only: sent, delivered, read, failed, played. A `delivered` event may be skipped entirely when a message is delivered and read in the same instant, so the UI must treat `read` as implying delivery. A failed message must display the numeric error code and a plain-English explanation drawn from the shared error classification table, which is keyed on **(api_surface, code)** and never on code alone (see §13 Sending engine and IB-31 below).

**IB-8** A contact profile sidebar must show, prominently and above the fold: consent status and consent source, opt-out status with the date and reason if opted out, tags and contact groups, any saved segments currently resolving to this contact, the client workspace, the campaign that prompted the current conversation, lifetime message counts, and the last engagement date. Opt-out status must be visually unmissable — an opted-out contact must render the composer with a persistent warning banner.

**IB-9** Users with a composing role must be able to add internal notes on a conversation. Notes must never be sent to WhatsApp, must be visually distinct from messages, and must record author and timestamp.

### 14.4 The 24-hour window — the defining constraint

Meta allows a business to send ordinary, free-form messages to a person only inside a 24-hour customer service window. The window opens when that person **messages or calls** the business number, and resets to a full 24 hours on every new inbound. Outside it, the only thing that can be sent is a pre-approved template; free-form sends on the `/messages` surface fail with error **131047**.

**IB-10** The system must track the window state per pairing of business phone number and WhatsApp user — not per contact, not per client — because a contact reachable on two CITS numbers has two independent windows.

**IB-11** The system must open or reset the window on every inbound message webhook and on every inbound call event, using the inbound message timestamp.

**IB-12** The system must persist the `conversation.expiration_timestamp` value that Meta returns on the `sent` status webhook and treat Meta's value as authoritative wherever it disagrees with the locally computed expiry.

**IB-13** The conversation view must display an always-visible window indicator with a live countdown. When under one hour remains it must change colour and state the exact remaining time in minutes.

**IB-14** When the window is closed, the composer must **hard-block free-form text, media, reactions and quoted replies**. The system must never queue, schedule or attempt a free-form send to a closed window. Instead the composer must switch to a template picker listing templates that are `APPROVED` for the language being sent, on the WABA that owns the client's templates. `PENDING`, `PAUSED`, `DISABLED` and `REJECTED` templates may be visible but must be unselectable in the inbox, and the sending engine must in any case refuse to release a message whose template is not `APPROVED` for the exact language (see §11 Templates, §13 Sending engine).

**IB-15** The closed-window state must be explained in one sentence, in plain English, without jargon. The required wording is: *"This person last wrote to you more than 24 hours ago, so WhatsApp only allows a pre-approved message from here — pick one below, or wait for them to reply."*

Why this surprises people: users expect a chat app to behave like WhatsApp on their phone, where they can always type. It does not. The restriction is Meta's, applies to every business on the platform, and cannot be worked around by using a different number or sending "just a quick note". Building the block into the composer is cheaper than explaining 131047 failures afterwards.

Cost note: replies inside the window are free today. From **2026-10-01** service messages and in-window utility templates become chargeable, so the window's cost advantage shrinks but does not disappear — free-form replies still avoid template approval delays entirely (see §17 Usage and cost tracking).

### 14.5 Replying

**IB-16** Inside an open window the composer must support text, image, audio, video, document, sticker, reaction (emoji on a specific message) and quoted reply (using the original message ID as reply context). Reactions and quoted replies are common in real conversations and must render correctly inbound as well as outbound.

**IB-17** The composer must enforce Meta's media size caps before upload and reject oversized files with a clear message: images 5 MB · audio 16 MB · video 16 MB · documents 100 MB · stickers 100 KB static and 500 KB animated. Video must be H.264 video with AAC audio and a single audio stream.

**IB-18** Interactive reply buttons and list messages are **out of scope for the v1 composer**. **[Verify before build]** — the commonly quoted limits (3 reply buttons, 10 list rows) are not primary-confirmed in the fact base and must not be coded against until checked.

### 14.6 Inbound media

**IB-19** Media received on an inbound webhook must be downloaded and stored in CITS-controlled object storage within minutes of receipt, by a queued worker. Meta retains webhook-received media for only **7 days**, and each download URL obtained from the media endpoint expires after **5 minutes**. A URL must be fetched and consumed inside a single job; never stored for later use.

**IB-20** If media download fails, the system must retry with backoff and raise an `OPERATIONAL_ALERT` if still unresolved after 24 hours, because the underlying asset is unrecoverable after 7 days.

### 14.7 Assignment and lifecycle

**IB-21** Assignment is manual only in v1. Any user holding Client Admin, Campaign Manager or Inbox Agent in the workspace may assign a conversation to themselves or to another such user in that workspace, or unassign it. Viewers cannot assign.

**IB-22** Unassigned conversations must appear in a shared "Unassigned" queue visible to everyone with inbox access in that workspace.

**IB-23** When a user account is deactivated, or when a user's Inbox Agent role in a workspace is removed, all conversations assigned to that user in that workspace must be moved to Unassigned automatically, and the change recorded in the audit log (see §18).

**IB-24** Conversations have exactly two states: `open` and `closed`. There is no snoozed, pending or deferred state. New inbound messages on a `closed` conversation must reopen it automatically and mark it unread. Closing is manual.

**IB-25** The system must never implement routing rules, skill-based distribution, SLA timers or auto-assignment in v1.

### 14.8 Who can do what in the inbox

**IB-35** Inbox access by role, within a workspace:

| Capability | Client Admin | Campaign Manager | Inbox Agent | Viewer |
|---|---|---|---|---|
| Read conversation list and history | Yes | Yes | Yes | Yes |
| Compose, reply, send template in closed window | Yes | Yes | Yes | **No — composer hidden** |
| Add internal notes | Yes | Yes | Yes | No |
| Assign / unassign conversations | Yes | Yes | Yes | **No — control hidden** |
| Open / close a conversation | Yes | Yes | Yes | No |
| Block a user (Meta Block Users API) | Yes | Yes | Yes | **No — control hidden** |
| Manage quick replies | Yes | Yes | No | No |
| Manage conversational components | Yes | No | No | No |
| See full phone numbers | Yes | Yes | Yes | Only with the "View full phone numbers" permission |

For Viewers the composer, assignment control and block control must be **hidden, not disabled** — a Viewer should never be shown an action they cannot take. Viewer read access is genuine read access: they see the full message history, the window badge, notes and the contact sidebar.

**IB-36** Viewer phone masking applies in the inbox exactly as it does elsewhere. Unless a Viewer has been granted the distinct "View full phone numbers" permission, every phone number rendered in the conversation list, the conversation header, the contact sidebar and any exported view must be masked to the last 4 digits. Search by phone number must still work for masked Viewers by matching against the stored number without revealing it.

### 14.9 Quick replies

**IB-26** Each client workspace must support a library of quick replies: a short name, plain text body, and optional variables substituted from contact fields at insert time (for example `{{first_name}}`). Inserting a quick reply must place editable text into the composer, never send directly.

**IB-27** A quick reply is an ordinary free-form message and is therefore subject to the 24-hour window exactly like typed text. When the window is closed, quick replies must be unavailable.

### 14.10 Automatic behaviour on inbound

**IB-28** On every inbound message the system must, in order: reset the 24-hour window; run opt-out keyword detection and apply suppression if matched (see §10); mark the contact as engaged with the current timestamp; attribute the reply to the most recent campaign message sent to that contact on that number within **`reply_attribution_window`**, a single platform setting defaulting to **7 days** (**CITS product policy, not a Meta rule**); mark the conversation unread; and notify the assigned Inbox Agent, or everyone with inbox access in the workspace if unassigned (see §18).

**IB-37** `reply_attribution_window` is one setting with one value, read from one place. Inbox attribution (IB-28) and the campaign report's "Replied" and "Opted out" counts (see §15 Reporting) must apply the same window to the same underlying data, so a reply counted in the inbox as belonging to a campaign is the same reply counted in that campaign's report, and vice versa. Changing the setting changes both. Reports must state the window value in use on the report itself.

### 14.11 Blocking a user — different from suppression

Blocking is a Meta-side action taken through the **Block Users API** (`/block_users`) on a specific business phone number. Suppression is a CITS-side database state that stops our system from sending. They are not substitutes and must both exist.

| | Block (Meta) | Suppression (CITS) |
|---|---|---|
| Where it lives | Meta, per business phone number | Our database, per contact per client |
| Effect | The user cannot reach that number | We do not send to them |
| Capacity | **64,000 users per number** | Unbounded |
| Batch size | **1,000 users per request** | n/a |
| Precondition | Target must have messaged that number **in the last 24 hours** | None |

**IB-29** The conversation view must offer a Block action, enabled only while the 24-hour window is open, with a confirmation dialog stating that blocking is permanent until manually reversed and consumes one of 64,000 slots on that number. The action is available to Super Admin, Client Admin, Campaign Manager and Inbox Agent; Viewers may not block (IB-35).

**IB-30** The system must never attempt bulk retroactive blocking. Because blocking requires a message in the last 24 hours, an old list of abusive numbers cannot be blocked, and the UI must say so rather than offering a control that always fails.

**IB-31** Block requests must be chunked to a maximum of 1,000 users per request, and their responses must be classified using the shared error classification table keyed on **(api_surface, code)** with `api_surface = /block_users`. Meta reuses numeric codes across endpoints with entirely different meanings, and the block path must never be interpreted with the send path's meanings:

| Code | Meaning on `/messages` | Meaning on `/block_users` | Required inbox behaviour |
|---|---|---|---|
| **131047** | Customer service window expired | Target has not messaged this number in the last 24 hours | Show "This person must have messaged you in the last 24 hours before you can block them." **Must not** trigger the send path's "send a template instead" fallback — offering a template in response to a failed block is nonsense. |
| **130429** | Throughput ceiling on sending | Request rate limit on the block endpoint | Back off and retry the block request. **Must not** decrement or throttle the send token bucket, and must not pause or slow any campaign. |
| **131021** | Sender and recipient are the same number | Self-block attempt | Show "You cannot block your own number." No send-path consequence. |
| **139101** | n/a | Blocklist full for this number | Raise an `OPERATIONAL_ALERT` and offer CITS-side suppression instead. |
| **139100** | n/a | Partial bulk failure | Persist the per-user results and show which succeeded and which did not. |

Restating the rule because it is the single easiest thing to get wrong here: a failure returned by `/block_users` is a block-path failure. It must never mark a message as failed, never count towards any campaign's failure rate or non-delivery rate, never consume send throughput, and never open a template picker. Attempts to block another WhatsApp Business account are not permitted by Meta and must be surfaced as such.

**IB-32** Blocking a user must also write a CITS-side suppression record. Unblocking must not automatically remove suppression. Both actions are audit-logged.

### 14.12 Conversational components

Welcome messages, ice breakers and commands are configuration attached to a business phone number that prompt a WhatsApp user to send something. Every resulting inbound opens a fresh 24-hour window at no messaging cost, which is the cheapest documented way to make in-window replies possible.

**IB-33** The system must allow each client's sender number to be configured with a welcome message, a set of ice breakers, and a set of commands, editable from the client workspace settings by a Client Admin, and version-controlled in the audit log.

**IB-34** **[Verify before build]** — the fact base does not record Meta's limits on the number of ice breakers, number of commands, or character caps for each. Confirm against Meta's conversational-components documentation before building the editor's validation.

This is worth building because it directly reduces spend: an inbound reply turns an otherwise-chargeable template send into a free in-window message. The benefit narrows on 2026-10-01 when in-window utility messages become chargeable, but does not vanish, since free-form replies remain outside template approval and outside marketing pricing.

### 14.13 Mobile tier

The inbox is **mobile-critical**: fully operable at 375px width, including reading history, replying inside an open window, picking a template when the window is closed, and assigning a conversation. The window countdown and the closed-window explanation (IB-15) must be legible without horizontal scrolling. Conversational-component configuration (IB-33) is **desktop-first**.

### 14.14 Deliberately out of scope for v1

The following are not built, and no partial version of them is built:

- **Per-agent conversation and response-time metrics.** There are no per-Inbox-Agent dashboards, no first-response-time or resolution-time measurements, no leaderboards and no exports of any of these. **Inbox Agents have no report access at all in v1** — the reporting area is not shown to them. Nothing in the inbox may promise, imply or link to agent performance reporting. Moved to the roadmap (see §24).
- Chatbot or flow builder, decision trees, keyword auto-responders beyond opt-out detection
- Automated routing rules, round-robin assignment, SLA timers, escalation
- AI reply suggestions or drafting
- Canned-response analytics
- Any channel other than WhatsApp
- **WhatsApp Flows** — relevant to abstract submission and registration forms, but excluded because it requires operating a live encrypted endpoint with an RSA key pair per WABA and health-check availability, which is a separate service with its own security and key-rotation burden
- **WhatsApp Business Calling API** — relevant to conference support desks, but excluded because business-initiated calling runs on a permission economy of roughly 1 call permission per user per day and 2 per week, and its pricing is not established anywhere in the fact base

All of the above are candidates for the roadmap (see §24), not for v1.

---

## 15. Reporting and dashboards

### 15.1 The campaign report

**RE-1.** The system must produce one report per campaign, available from the moment the campaign starts and permanently thereafter. Where a campaign has more than one attempt (see the definition of `attempt_key` in §12), the report must show every attempt in the same report, itemised separately and in total. The report must show these counts, each defined exactly as below.

| Metric | Definition |
|---|---|
| Total selected | Contacts matched by the campaign's audience rules at audience-snapshot time |
| Excluded | Removed before queueing: suppressed, opted out, duplicate, syntactically invalid number, missing required variable, blocked by the CITS-side frequency governor. Broken out by reason, with the frequency governor shown as its own reason |
| Final recipients | Total selected minus excluded. **This is the denominator for every rate below** |
| Queued | Rows written to the send outbox |
| Accepted | Meta returned HTTP 200 with a message id (`accepted`) |
| Held by Meta for quality assessment | Meta returned `held_for_quality_assessment`. Neither sent nor failed — a limbo state (see §13) |
| Dropped by Meta pacing | Terminal failures carrying error 132015 (template pacing kill) or 135000 (portfolio pacing drop) |
| Blocked by per-user frequency cap | Terminal failures carrying error 131049 on the `/messages` surface |
| Sent | `sent` status webhook received |
| Delivered | `delivered` status webhook received, or `read` received without a preceding `delivered` |
| Read | `read` status webhook received |
| Failed | `failed` status webhook received, **excluding** 131049, 132015 and 135000, which are reported separately |
| Replied | Contacts who sent any inbound message within the `reply_attribution_window` of their campaign message |
| Opted out | Contacts whose suppression record was created within the `reply_attribution_window` of their campaign message |

**RE-2.** The system must never fold error 131049 into the failure count. Being blocked by Meta's per-user marketing frequency cap is a delivery-throttling outcome, not a content or data defect, and the report must present it as its own category with the plain-English label "Meta withheld this message because the recipient had already received too many marketing messages recently." Meta publishes no number for this cap (see §2). Messages excluded by the separate **CITS-side frequency governor** (see §8 and §10) never reach Meta at all and must appear only under Excluded, never in any Meta outcome category.

**RE-2a.** `reply_attribution_window` is a single setting with a default of **7 days**. It is CITS product policy, not a Meta rule. The same setting value must drive inbox reply attribution, the "Replied" count and the "Opted out" count, so that the inbox and the campaign report can never disagree. The window in force must be printed next to both counts.

**RE-3.** Every rate must be displayed with its denominator printed next to it. The system must use exactly these definitions and no others:

- Delivery rate = delivered ÷ final recipients
- Read rate = read ÷ delivered
- Reply rate = replied ÷ delivered
- **Failure rate** = failed ÷ final recipients
- **Non-delivery rate** = (failed + dropped by pacing + blocked by frequency cap) ÷ final recipients, displayed with its three components itemised beneath it

Messages blocked by the per-user marketing frequency cap (error 131049) and messages dropped by Meta's pacing must never be summed into the failure rate. They appear only in the non-delivery rate, and only as separately labelled components.

**RE-3a.** Any rate whose numerator was never captured inside Meta's 7-day analytics window must render as **"not captured"**, never as zero and never as a blank. This applies to read rate, click-through rate and any rate derived from them. The report must state which figures are not captured and why, so that a report rendered long after the campaign cannot silently present a 0% read rate as though it were a measured result. See RE-13.

**RE-4.** The report must include a failure breakdown table: error code, the API surface the code was returned on, Meta's title, a CITS-authored plain-English explanation, the recommended action, and the affected contact count, with a link to the contact list. The explanations must come from the error-code reference table held as data and keyed on **(api_surface, code)** (see §13), not from hardcoded strings, so they can be corrected without a deploy.

**RE-5.** The following caveats must be printed on the report itself, not buried in help documentation:

- When a message is delivered and read in the same instant, Meta may skip the `delivered` webhook entirely. Because this report counts a `read` with no preceding `delivered` as delivered, the delivered figure is **complete but partly inferred**: for those recipients delivery is deduced from the read event rather than observed directly. It is not a floor. A naive counter that tallied only raw `delivered` webhooks would produce a floor; this report deliberately does not do that, and the report must say which recipients were counted by inference.
- A recipient using WhatsApp on several devices can generate both a `delivered` and a `failed` event for the same message. The system counts delivery to at least one device as delivered.
- Read receipts are unavailable when the recipient has switched them off in WhatsApp. Read rate is therefore a floor, never a true figure, and is not comparable across audiences.

**RE-6.** The system must make every campaign report reproducible months after the fact. On campaign start it must snapshot and store: the full template content as sent (body, header, footer, buttons, language), the **template version id** used, the template's Meta status and category at send time, the WABA the template belongs to, the resolved audience (the contact ids, not the filter rules — and, where a saved segment was used, the contact ids the segment resolved to at that moment), the per-contact variable values, the sending phone number, and the identifier of the rate-card version used for cost estimation. Reports must render from these snapshots, never from the current state of the template, segment or audience.

**RE-6a.** Where a campaign required approval (recipient count at or above the **campaign approval threshold**, default 1,000 — see §12), the report must show approval-requested-by, approval-requested-at, approved-by, approved-at and the approval note, drawn from the campaign record.

**RE-7.** Every campaign report must be exportable to Excel (.xlsx, generated with exceljs) and CSV, containing both the summary figures and a per-recipient row. Exports must be generated as background jobs and delivered as a download link, and every export must be recorded in the audit log (see §18).

**RE-7a.** Phone numbers shown anywhere in a campaign report, a click report or their exports must be masked to the last four digits for any user who does not hold the distinct **"View full phone numbers"** permission. Holding **Viewer** does not by itself grant it. Masking applies to on-screen per-recipient lists, drill-through lists and generated exports alike; an export produced by a user without the permission must contain masked numbers in the file itself.

### 15.2 Client-facing proof-of-delivery report

**RE-8.** The system must produce a separate, presentable "proof of delivery" report that CITS staff can hand to a society as evidence that a campaign ran. It must contain: the client organisation name, campaign name, sending display name and number, the date and time window of sending, the message content as sent, final recipient count, delivered count, read count, reply count, the failure total as a single number, and the caveats from RE-5.

**RE-9.** The proof-of-delivery report must never contain: individual phone numbers or contact names, per-recipient status, Meta error codes, internal contact or campaign identifiers, cost figures, or any data belonging to another client. It must be exportable as PDF and must carry a generation timestamp and the generating user's name.

### 15.3 Analytics warehousing

**RE-10.** The system must maintain its own permanent copy of Meta's analytics, because Meta's own copy expires. Specifically: `template_analytics` returns sent, delivered, read and clicked figures at daily granularity with a 90-day lookback, **but read and click data are available only up to 7 days from send**; and the general `analytics`, `conversation_analytics` and `pricing_analytics` lookback was **cut from 10 years to 1 year on 2025-12-01**. Data not collected inside those windows is gone permanently.

**RE-11.** A named background job, `meta-analytics-sync`, must run at least once every 24 hours and must, for every sending number: pull `template_analytics` for all templates used in the last 14 days, and pull `analytics`, `conversation_analytics` and `pricing_analytics` for the previous complete day. Results must be written to append-only warehouse tables keyed on (phone number, template, date, metric) and must be idempotent on re-run.

**RE-12.** If `meta-analytics-sync` fails, or does not complete, for two consecutive scheduled runs, the system must raise a high-severity alert to CITS staff via the notification channel in §18 and surface a red banner on the CITS master dashboard. Given the 7-day read/click window, a silent failure of this job is unrecoverable data loss and must be treated as a production incident.

**RE-13.** The system must record, per warehouse row, whether the figure was captured inside Meta's retention window or backfilled late, and must record explicitly where a metric was **never captured** because the window closed before any sync ran. Charts must show a gap, never a zero, where no data was captured, and every derived rate must follow RE-3a and render as "not captured". A campaign report opened thirty days after the fact must therefore state that read and click figures were not captured, rather than showing 0%.

### 15.4 Dashboards

**RE-14.** The CITS master dashboard (visible to holders of **Super Admin**, and to other CITS staff only through the workspaces they hold a role in) must show: total clients; total contacts; active contacts; opted-out contacts; campaigns sent this month; messages sent this month; the ten most recent campaigns; the ten most recent inbound replies; failed messages in the last 7 days; campaigns currently awaiting approval (`pending_approval`), with their requesting user and recipient count; and the list of clients with a campaign currently `running`.

**RE-15.** The master dashboard must additionally show these operational tiles, refreshed at least every 15 minutes:

- **Portfolio headroom** — unique recipients messaged outside customer-service windows in the rolling 24 hours, against the current portfolio messaging limit, as a used/remaining figure and a percentage. Because messaging limits and quality have been pooled at the **business portfolio** level since 2025-10-07, this is a single shared cap across every CITS client, and the tile must say so in words.
- **Portfolio pacing state** — whether the portfolio currently sits below the 500,000 template messages in a rolling 365 days threshold at which portfolio pacing applies, with the live rolling-365-day count shown as read from data, never assumed. At CITS's year-one volumes this tile will normally read "pacing applies".
- **Quality rating per sender number** — GREEN / YELLOW / RED, with the timestamp of the last change.
- **Paused, disabled or rejected templates** — any template currently in PAUSED, DISABLED or REJECTED status, with the client and WABA it belongs to.
- **Templates pending approval** — any template in PENDING status, with the client, WABA, language and time in state.
- **Active Meta restrictions** — any enforcement action reported on the `account_update` webhook, with its stated end time if Meta provided one.
- **Webhook health** — time since the last webhook received, count of signature-verification failures in the last hour, and the count of **unresolved sends** (accepted by Meta but with no terminal status after `unresolved_send_age`).

**RE-15a.** `unresolved_send_age` is a single setting with a default of **6 hours**. The same value must be used by the reconciliation sweep, by the unresolved-sends dashboard tile and by the unresolved-sends alert, so that the three can never report different populations. The tile must print the age threshold in force.

**RE-16.** The per-client dashboard must show, scoped strictly to that client's data: total contacts; contact groups and saved segments; the ten most recent campaigns; **scheduled and upcoming campaigns** with their scheduled time and recipient count; campaigns awaiting approval; delivery rate over the selected period; recent replies; the **unread inbox count** for that client's `open` conversations; opt-outs in the period; failed contacts; the **quality rating and connected/restricted state of that client's sender numbers**, with the timestamp of the last change; **pending template approvals** for that client's WABA; and a usage summary linking to §17.

**RE-16a.** Cost and usage tiles on any dashboard must be rendered **only** for users holding the view-usage-and-cost permission. For every other user the tiles must be **omitted entirely** — not shown as zero, not shown masked, not shown as "hidden". **Inbox Agent** holds no report access at all: no campaign report, click report, dashboard or export. The product must not promise per-agent conversation or response-time metrics; these are not in v1.

**RE-17.** All dashboard time handling must follow these rules. The system must store all timestamps in UTC. It must display all times in Asia/Kolkata (IST) in v1, with the time zone label shown next to every date range. "This month" means from 00:00 IST on the first day of the current calendar month to now. "Last 7 days" means the rolling 168 hours ending now, not seven calendar days. Every dashboard must print the exact range it is showing, for example "1 Jul 2026 00:00 – 21 Jul 2026 14:30 IST".

**RE-18.** Every count on every dashboard must be clickable and must navigate to the filtered list that produced it, with the same filters and date range pre-applied. A number the user cannot drill into must not be displayed.

**RE-19.** Dashboard aggregates may be served from cached rollups no older than 15 minutes, and the cache age must be displayed. Drill-through lists must always query live data.

**RE-20.** Mobile tiers for this section: campaign reports and dashboards are **mobile-usable** — readable and navigable at 375px, with drill-through lists reduced to their key columns; export configuration is deferred to a larger screen. The proof-of-delivery report preview and the usage and cost screens (§17) are **desktop-first** — at 375px they degrade to a legible read-only view with a "best used on a larger screen" notice, never a broken layout.

## 16. Click tracking

### 16.1 Click tracking

**CK-1.** The system must implement click tracking through a URL button on the template, shaped as a fixed base URL followed by a single trailing variable — for example `https://go.example.org/c/{{1}}`. This shape is mandatory because Meta appends a URL-button variable **only to the end of the URL string**. Any design that places the variable in the middle of a path or between query parameters will not work.

**CK-2.** The system must percent-encode the token before placing it in the button variable, and must generate tokens using only URL-safe characters. Templates may carry at most two URL buttons and a URL may be at most 2,000 characters (see §11).

**CK-3.** The system must issue one unique, opaque, non-guessable token per (campaign, contact) pair. Tokens must not encode the phone number or contact name and must not be sequential.

**CK-3a.** The token must be wired into the send path explicitly. At **audience-snapshot time**, when the campaign's resolved audience and per-contact variable values are frozen (RE-6), the system must generate each recipient's token and write it into that recipient's stored resolved parameter values as the **trailing URL-button variable**. The sending engine must then send exactly those stored values and must never mint a token at release time. Consequences that must hold: a recipient's token is identical across automatic retries because those reuse the same `attempt_key`; an operator-initiated retry creates rows under `attempt_key+1` and must generate fresh tokens for that attempt, so clicks are attributable to the attempt as well as the campaign; and any recipient whose resolved values are missing the token must fail the pre-flight missing-variable check rather than being released with an empty button variable.

**CK-4.** Tracked links must be served from a **business-owned, verified HTTPS short-link domain** controlled by CITS or the client, on a valid TLS certificate. Generic public shorteners such as bit.ly and tinyurl must be rejected at composer validation time (see §11). Two honest caveats must be recorded in the product documentation: Meta publishes no rule endorsing branded short domains, so this is a risk-reduction measure rather than a documented requirement; and a brand-new redirect domain is itself a reputational risk with mail and link scanners. **[Verify before build]** The blocking of generic shorteners is consistently reported by every major BSP as Meta guidance but is not stated in Meta's live template documentation; enforcement in practice appears through SCAM and ABUSIVE_CONTENT rejections.

**CK-5.** CITS product policy, not a Meta rule: a new short-link domain must be warmed before heavy use — used on low-volume utility and internal campaigns for at least 30 days before being used on a marketing blast.

**CK-6.** The redirect handler must, on every request: look up the token; write a click log row containing token, resolved contact id, campaign id, attempt key, message id (wamid), client id, timestamp, user agent and coarse referrer **before** responding; then respond with an HTTP 302 to the destination URL with campaign parameters appended (`utm_source=whatsapp`, `utm_medium=<template category>`, `utm_campaign=<campaign slug>`, `utm_content=<template name>`). If the token is unknown, the handler must redirect to the client's configured fallback URL and log the miss.

**CK-7.** The redirect handler must respond within 300 milliseconds at the 95th percentile and must never show an interstitial page. Logging must not block the redirect beyond a single database write; if the write fails, the redirect must still occur and the failure must be recorded to the error log.

**CK-8.** The click report must show: total clicks, unique clicks (distinct contacts), click-through rate against delivered, the list of contacts who clicked with the time of their first and last click, the campaign, attempt and template the click came from, and a time-of-day distribution. Phone numbers in the click report and its exports are masked per RE-7a unless the viewer holds the "View full phone numbers" permission. It must be exportable alongside the campaign report.

**CK-9.** The system must also store Meta's native button-click metrics from `template_analytics` and display them next to CITS's own click figures, labelled as Meta's count. The two will not match — Meta counts button taps, CITS counts redirect hits. The report must state this. Meta's click data is subject to the same 7-day retention as read data (see RE-10) and must follow RE-3a: where it was never captured it renders as "not captured", never as zero. It is not available at all for recipients in the EEA, the UK, Japan, South Korea, Nigeria and South Africa when sending via the Marketing Messages API, and must be labelled as unavailable rather than zero for those recipients.

**CK-10.** Click logs are personal data. The system must retain per-contact click logs for 12 months, after which the contact identifier must be irreversibly removed and only the aggregate counts retained. Retention must be configurable per client. See §20 for the lawful basis and the erasure obligation.

**CK-11.** Per-recipient click attribution is thinly executed or gated behind higher-priced tiers across the competing Indian tools. It must be built to the standard above in v1 rather than deferred, because it is one of the few genuine differentiators available to CITS.

## 17. Usage and cost tracking

### 17.1 Usage and cost tracking

**UC-1.** The system must record, per client organisation and per calendar month (IST): messages sent, delivered and failed, each split by template category (Marketing, Utility, Authentication) and by pricing category as reported by Meta; estimated Meta cost; estimated GST; and a **CITS service charge**, recorded and displayed but never billed, invoiced or collected in v1.

**UC-1a.** The CITS service charge must be a defined, configured value, not a free-floating field. It is configured **per client**, with a platform-wide default, and each client's configuration selects one of two forms: a **percentage** applied to that client's estimated Meta cost for the period, or a **flat per-message amount** applied to chargeable deliveries. Only one form may be active for a client at a time. Service-charge configurations are **versioned by effective-from and effective-to date exactly like a rate card** (UC-5), and the engine must select the version whose effective range contains the message's delivery timestamp, so that historical months recompute correctly after a change. Every displayed service-charge figure must name the service-charge version used and carry the label "Estimated — not billed in v1". Only users holding the view-usage-and-cost permission may see or configure it.

**UC-2.** The cost engine must accrue charges on **delivery**, never on send. A message that is accepted, held, dropped by pacing, blocked by the frequency cap, or failed must contribute zero cost. Messages suppressed by the CITS-side frequency governor never enter the outbox and contribute nothing.

**UC-3.** The rate applied must be determined by the **recipient's** country, derived from the E.164 country calling code of the destination number, not by CITS's country or the sender number's country.

**UC-4.** The system must read the `pricing` object from the **`sent`** status webhook and store `billable`, `pricing_model`, `type` and `category` against the message. From Graph API v24.0 onwards the `pricing` and `conversation` objects no longer appear on `delivered` and `read` webhooks except for free-entry-point conversations, so the `sent` event is the only reliable source. Where Meta reports `billable: false`, the system must record zero cost regardless of what the rate card says.

**UC-5.** Rate cards must be stored as versioned data rows — never in code — with the fields: currency, market or country code, category, rate, effective-from date, effective-to date, source document reference, and the name of the person who entered them. The cost engine must select the rate card row whose effective range contains the message's delivery timestamp. Meta revises rates roughly quarterly and revised India's rates at least twice during 2026.

**UC-6.** Current India rates to seed the first rate card, all **[Verify before build]** — Meta no longer renders India numerals inline and publishes them only in an INR rate-card file behind Business Manager. The direction, date and currency are confirmed; the numerals are transcribed from a secondary source and must be checked against the INR rate card before go-live.

| Category | INR rate (unconfirmed) | Effective from |
|---|---|---|
| Marketing | 0.8631 | 2026-01-01 |
| Utility | 0.115 (free when delivered inside an open 24-hour customer-service window, until 2026-10-01) | 2026-01-01 |
| Authentication (domestic) | 0.115 | 2026-01-01 |

**UC-7.** Every cost figure displayed anywhere in the product must be labelled "Estimated" and must name the rate-card version used to compute it. A figure without a version label must not be rendered.

**UC-8.** GST at 18% must be applied as a separate, configurable line item on top of Meta charges, never blended into the message rate, and the percentage must be stored as versioned data with effective dates like the rate cards.

**UC-9.** The cost engine must model the **2026-10-01** change from the outset, driven entirely by effective-dated rate-card data rather than by branching code: from that date, service messages (free-form replies inside the window) become chargeable per message, and utility templates delivered inside an open customer-service window become chargeable. Out-of-window utility templates have been chargeable since 2025-07-01; what changes is the in-window exemption. The seeded rate card must therefore carry a pre-October row and a post-October row for utility and service, and the system must be able to produce a correct cost for any historical month on either side of the boundary.

**UC-10.** The system must record volume-tier treatment honestly. Volume discounts apply to **utility and authentication only** — marketing has no volume discount — and the tiers aggregate at the **business portfolio** level across every WABA and every client in that portfolio. Because CITS owns one portfolio containing all clients, a tiered rate is earned collectively and cannot be attributed to any one client on first principles.

**UC-11.** Where a tiered rate has been applied, the per-client cost figure must be presented as an **allocation, not a true cost**, and the report must print that sentence. The default allocation method in v1 is pro-rata by that client's share of chargeable utility and authentication deliveries in the month. The allocation method used must be stored with the monthly figure.

**UC-12.** The India volume-tier ladder itself is **[Verify before build]** — the reported bands (up to 25,000; 25,000–100,000; 100,000–250,000; 250,000+, discounts up to 30%) come from a single secondary source and are not confirmed by Meta. At the year-one scale of under 50,000 messages per month across all clients, CITS is unlikely to leave the lowest band, so v1 may apply list rates and record a note; the data model must nonetheless carry tier bands from the start.

**UC-13.** The system must provide a monthly reconciliation view per sending number that places CITS's own estimate next to the figures pulled from Meta's `pricing_analytics` and `conversation_analytics` (see RE-11), showing the absolute and percentage variance. A variance above 5% in either direction must raise a notification to CITS staff. Five percent is CITS product policy, not a Meta rule.

**UC-14.** The usage report must carry the standing statement that CITS's figures are an **estimate** until reconciled against Meta's own billing statements, and that Meta's invoice, not this product, is the authoritative record of what was charged.

**UC-15.** The system must retain per-message cost records for at least seven years to support later billing, tax and audit needs, independent of the shorter retention applied to message content (see §20). Meta itself retains message data for a maximum of 30 days and is not a system of record.

**UC-16.** Two dated platform changes must be tracked as configuration, not built into v1 logic: from **2026-08-01** Meta Business Agent messages become chargeable at 2.00 USD per million tokens **[Verify before build]** (not a v1 feature, but the rate-card model must be able to hold a token-priced item), and all India-eligible WABAs must be migrated to INR by **2026-12-31**, with Meta ceasing delivery from non-INR WABAs of eligible India customers on **2027-01-01**. The latter is an operational deadline owned by §7, referenced here because it invalidates any non-INR cost history after that date.

---

## 18. Audit logs and notifications

### 18.1 What must be logged

`AU-1` The system must write an audit entry for every action in the table below. Entries are written by the API layer, not the browser, so an action performed through a script or background worker is logged identically to one performed through the UI.

| Category | Logged events |
|---|---|
| Access | User login, failed login attempt, logout, password reset, session revoked |
| Clients | Client workspace created, updated, and every client status transition between `onboarding`, `active`, `paused`, `suspended` and `archived` |
| Senders | WhatsApp phone number added, registered, deregistered, removed; display name changed; data-localisation region changed; a registration or deregistration attempt refused by the attempt guards |
| Secrets | Access token stored, revealed, rotated, revoked |
| Contacts | Contacts imported (file name, row counts); undo-import performed (import identifier, count of contacts deleted, count skipped because already messaged or replied); contacts exported (row count, filters used, whether phone numbers were unmasked); contact deleted |
| Contact merges | Contacts merged (surviving contact, absorbed contact, fields taken from each) and merge undone |
| Erasure | Contact erased under a rights request, recording which fields were redacted, which records were retained in redacted form, and the requester and approver |
| Consent | Opt-in evidence recorded or amended; opt-out status changed in either direction, with the reason and the source of the change; deliverability state changed between `unknown`, `deliverable`, `suspect` and `invalid`, including an operator reversal of `suspect` |
| Campaigns | Campaign created, submitted, approval requested (by whom, when, recipient count at submission), approval granted or refused (by whom, when, approval note), scheduled, launched, paused, resumed, stopped, cancelled, and every campaign state transition with the state before and after |
| Campaign attempts | An operator-initiated retry of a specific recipient set, recording the new `attempt_key` and the recipient count under it |
| Reports | Report export (campaign report, click report, delivery report), recording the report type, the filters, the row count and whether phone numbers were unmasked — logged separately from contact exports |
| Messaging | Manual reply sent from the inbox, conversation moved between `open` and `closed`, contact blocked or unblocked |
| Templates | Template created, template version created (language, body hash, who created it), submitted to Meta, approved, rejected, paused, disabled, deleted |
| Users | User invited, workspace role changed, `super_admin` granted or removed, "view full phone numbers" permission granted or removed, user deactivated, reactivated |
| Settings | Any workspace or platform setting changed, including the typed-confirmation threshold, the campaign approval threshold, the CITS frequency-governor ceiling, `unresolved_send_age` and `reply_attribution_window` |
| Cross-workspace | Any read or write performed by a Super Admin inside a client workspace they are not a member of |

`AU-2` Every audit entry must carry: the acting user identity (or the named background worker), the action name, a UTC timestamp with millisecond precision, the client workspace the action affected, the affected object type and identifier, the before and after values for any change, the source IP address, the user agent string, and a correlation identifier shared by every log line, queue job and outbound API call belonging to the same request.

`AU-3` Before and after values must never contain a full access token, a password hash, or a full message body. Tokens are recorded as "changed" only (see `SC-9`). Contact phone numbers may appear, since they are the object being acted on; the audit viewer applies the same masking rule as everywhere else (`SC-23`).

`AU-4` Cross-workspace access by a Super Admin must be logged with a distinct event type and must be visible to that client's own Client Admins in their workspace audit view. A Super Admin must not be able to inspect a client's data invisibly.

`AU-4a` An erasure entry must record what was redacted rather than the values redacted. The entry names the fields cleared and the records left in redacted form; it must never store the erased values, because that would defeat the erasure.

### 18.2 Append-only guarantee

`AU-5` The audit log must be append-only. The application must expose no route, no admin screen and no support tool that updates or deletes an audit entry, for any role including Super Admin. The database role used by the application must hold INSERT and SELECT rights on the audit table and must not hold UPDATE or DELETE rights. A deliberate database-superuser action outside the application is the only way to alter the table, and that is itself a break-glass event.

`AU-6` Audit entries must be retained for **7 years** (CITS policy, chosen to sit comfortably above every obligation below). India's DPDP Rules require access logs to be retained for **at least one year** (see `CO-8`); the retention job must therefore never delete an entry younger than one year even if a future policy shortens the window.

`AU-7` The audit log must be searchable by user, by client workspace, by action type and by date range, and exportable as CSV by a Super Admin and by a Client Admin for their own workspace only. Campaign Managers, Inbox Agents and Viewers have no audit-log access.

### 18.3 Notifications

`AU-8` v1 must deliver notifications in-app only: a notification centre with unread counts, filterable by client workspace. Email delivery is a v2 addition (see §24 Roadmap) and the notification records must be stored with a delivery-channel field from day one so email can be switched on without a data migration.

`AU-9` Every notification must be classified as **Informational** (appears in the notification centre, no escalation) or **Paging** (appears in the notification centre, is highlighted persistently until acknowledged, and — once email lands — is emailed to the CITS operator immediately). Paging notifications are the ones where sending is already stopped or is about to stop.

| Trigger | Class | Why |
|---|---|---|
| Campaign started | Informational | Routine |
| Campaign completed or `partially_delivered` | Informational | Routine |
| Campaign approval requested | Informational | Needs a decision, but nothing is broken; routed to approvers under `AU-13` |
| Campaign approved | Informational | Routine |
| Campaign approval refused | Informational | Carries the approval note back to the requester |
| Contact replied | Informational | Handled by the inbox |
| Template approved | Informational | Routine |
| Template submitted | Informational | Routine |
| Campaign failed to launch (`failed`) | **Paging** | Nothing is being sent |
| Campaign refused at pre-flight because the client is `suspended` | **Paging** | The campaign stays `scheduled` and will not send |
| Campaign `stopped_by_meta` | **Paging** | Meta halted the send mid-flight |
| Campaign failure rate above threshold | **Paging** | CITS policy threshold, see `AU-10`; failure rate as defined in §15, never inflated by frequency-cap or pacing exclusions |
| Template rejected | Informational | Blocks one campaign, not the account |
| Template paused (3h, then 6h) | **Paging** | Meta's pausing ladder; a third instance disables the template permanently with no appeal |
| Template disabled | **Paging** | Unrecoverable; a new template must be authored |
| Template or phone-number quality rating dropped | **Paging** | Precedes pausing and enforcement |
| Enforcement action on the account (`account_update`) | **Paging** | Must display the restriction end time from the webhook payload |
| Payment method problem (`/messages`, 131042) | **Paging** | Stops all sending for every client at once |
| Access token failure (`/messages`, 190 / 0 / 200) | **Paging** | Stops all sending |
| Webhook endpoint unhealthy or lagging | **Paging** | Delivery receipts and inbound replies are silently being lost |
| Unresolved-send backlog above threshold (sends older than `unresolved_send_age`, 6 hours) | **Paging** | Messages accepted by Meta with no terminal status |
| Messaging-limit utilisation approaching the portfolio cap | **Paging** | Shared across all clients — see §2 and §5 |
| Portfolio daily headroom exhausted or a launch blocked for lack of headroom | **Paging** | Sending capacity is gone for the day |
| Many opt-outs in a short window | **Paging** | Leading indicator of a quality collapse |
| WhatsApp number left `connected` status | **Paging** | That client cannot send |
| A registration or deregistration counter reaching its eighth attempt in 72 hours | **Paging** | Two attempts from an unconditional refusal |

`AU-10` Every numeric threshold in the table above (failure-rate percentage, opt-out count and window, backlog size, utilisation percentage) is **CITS product policy, not a Meta rule**. Meta publishes no thresholds for quality, block rate or read rate. Each threshold must be stored as a configurable setting with a documented default and must be labelled in the UI as a CITS setting.

`AU-11` The system must deduplicate notifications: repeated occurrences of the same trigger for the same object within a configurable window must increment a count on one notification rather than creating many.

`AU-12` Because messaging limits and quality are pooled at the **business portfolio** level since 2025-10-07, a paging notification caused by one client must be visible to the CITS operator as a portfolio-wide event, and must name every other client workspace whose sending is at risk. Portfolio-level notifications are CITS-only — see `AU-14`.

### 18.4 Notification recipient routing

`AU-13` Every notification has a defined default audience by role. Routing is per workspace except where the row says portfolio.

| Notification group | Super Admin | Client Admin | Campaign Manager | Inbox Agent | Viewer |
|---|---|---|---|---|---|
| Campaign lifecycle for a campaign they created (started, completed, `partially_delivered`, cancelled) | Yes | Yes | Yes (own campaigns) | No | No |
| Campaign approval **requested** | Yes | Yes | No (the requester gets the decision, not the request) | No | No |
| Campaign approval **granted or refused** | Yes | Yes | Yes (the requester) | No | No |
| Campaign failure, `stopped_by_meta`, failure rate above threshold, pre-flight refusal | Yes | Yes | Yes (own campaigns) | No | No |
| Template lifecycle (submitted, approved, rejected, paused, disabled) | Yes | Yes | Yes | No | No |
| Contact replied / new inbound conversation | No (opt-in only) | Yes | No | Yes (assigned or unassigned conversations in their workspace) | No |
| Opt-out spike for that client | Yes | Yes | Yes | No | No |
| That client's own sender number leaving `connected`, or that client's quality rating dropping | Yes | Yes | No | No | No |
| Client status changed (e.g. to `suspended`) | Yes | Yes | No | No | No |
| **Portfolio-level operational alerts** — messaging-limit utilisation, portfolio headroom exhaustion, payment method problem, access token failure, webhook endpoint health, unresolved-send backlog, enforcement action on the business portfolio | Yes | **No** | **No** | **No** | **No** |

`AU-14` Client-side users must never receive portfolio-level operational alerts. The portfolio is shared across every CITS client, so its state, its utilisation and the identity of the other clients on it are not one client's business. Where a portfolio condition affects a specific client, that client's users receive a separate, client-scoped notification that states only the consequence for that workspace ("sending for this workspace is paused until 18:00 UTC") and never the portfolio figures or the other clients involved. The portfolio-wide view described in `AU-12`, including the list of affected workspaces, is visible only to Super Admins.

`AU-15` A Super Admin may add or remove individual recipients on any notification class, and may subscribe themselves to a client-scoped class they do not receive by default. Client Admins may adjust routing only within their own workspace and only among that workspace's own users, and only for classes their workspace receives at all.

`AU-16` Muting is per user, per notification class, per workspace. Muting suppresses the notification-centre highlight and, once email lands, the email — it never suppresses the underlying audit entry, and it never suppresses the condition itself.

`AU-17` **Paging-class notifications must not be mutable by anyone other than a Super Admin.** A Client Admin, Campaign Manager, Inbox Agent or Viewer must find the mute control disabled on any paging-class notification, with an explanation of why. A Super Admin may mute a paging class, but only with a stated reason and an expiry (maximum 30 days, after which the mute lapses automatically); the mute, its reason and its expiry are audit-logged under Settings, and an active paging-class mute must be displayed as a standing banner on the platform health screen so it can never be forgotten.

---

## 19. Security

### 19.1 Authentication and authorisation

`SC-1` All access to the application must require authentication. Sessions must expire after a configurable idle period and must be revocable by an administrator, with revocation taking effect on the next request rather than at session expiry.

`SC-2` Authentication endpoints (login, password reset, invitation acceptance) must be rate limited per IP address and per account, with progressive delay and temporary lockout. Failed attempts must be logged (`AU-1`).

`SC-3` Every API route must perform an authorisation check naming the required role — one of `super_admin`, `client_admin`, `campaign_manager`, `inbox_agent`, `viewer` — and the client workspace in scope. A route with no explicit check must fail closed, and the test suite must assert that every registered route is covered by a check.

`SC-3a` Approval authority is a hard authorisation check, not a UI affordance: only a Client Admin in the workspace or a Super Admin may move a campaign out of `pending_approval`. A Campaign Manager must not be able to approve any campaign, including one they submitted themselves, through the UI or by calling the route directly.

### 19.2 Tenant isolation — hard acceptance criterion

`SC-4` Tenant isolation must be enforced **in the database**, either through PostgreSQL row-level security keyed on a session-scoped tenant identifier, or through a single mandatory query helper that injects the tenant predicate and which application code has no way to bypass. Isolation enforced only by remembering to add a `WHERE` clause in application code is a hard fail. See §5 Multi-client management.

`SC-5` Raw string interpolation into SQL template literals must be banned in the coding standards and blocked by a lint rule. Drizzle ORM must be pinned at `>=0.45.2`, because earlier versions carry a SQL-injection vulnerability in identifier handling.

`SC-6` An automated test suite must attempt cross-tenant access through **every** route — read, write, list, export, file download and webhook-triggered path — using a user belonging to workspace A requesting objects in workspace B, and must expect failure on every one. This suite must run in continuous integration and a failure must block deployment. Adding a route without adding its cross-tenant test must fail the build.

`SC-7` Super Admin cross-workspace access is the one permitted exception and must be explicit: a deliberate "enter workspace" action, audited under `AU-4`, never an implicit global query. A user who operates several clients does so by holding **Campaign Manager** in each of those workspaces; there is no cross-workspace operator role and no route may grant one.

### 19.3 Access token handling

`SC-8` WhatsApp access tokens must be stored envelope-encrypted: a per-record data key encrypts the token, and the data key is itself encrypted by a master key held in a key management service. The master key must never be present in the application repository or in a plain environment file.

`SC-9` A token must never be returned to the browser as part of any normal read. Tokens must never be written to application logs, queue payloads, error messages, or Sentry events; the Sentry integration must run a scrubber that redacts any field named like a token, secret, key or authorization header, and an automated test must assert the scrubber works.

`SC-10` Revealing a token must require a deliberate, separately confirmed Super Admin action which produces an audit entry (`AU-1`, Secrets) and an immediate paging notification. Tokens must be stored in a variable-length column and must never be parsed or validated by shape — Meta documents them as opaque strings.

`SC-11` A documented rotation and revocation path must exist and must be exercised at least once before launch: generate a replacement token, store it, verify a test send, invalidate the old one, and confirm the audit trail. Because Meta does not state whether business system user tokens expire, the system must treat token failure (`/messages` errors 190 / 0 / 200) as an expected operational event with a runbook, not an incident. The token health check runs **every 6 hours**.

### 19.4 Webhook endpoint security

`SC-12` The webhook receiver must verify the `X-Hub-Signature-256` header as an HMAC-SHA256 over the **exact raw request bytes**, never over re-serialised JSON, using the Meta App Secret, compared with a constant-time comparison function. Requests with a missing, malformed or mismatched signature must be rejected and must never be processed or persisted as valid.

`SC-13` The webhook verification handshake must validate the `hub.verify_token` value against a stored secret before echoing `hub.challenge`.

`SC-14` The webhook endpoint must be rate limited and must acknowledge with HTTP 200 quickly, persisting the raw payload and processing asynchronously. Meta retries deliver duplicates by design, so processing must be idempotent on the status event dedupe key **(wamid, status)** only; the provider timestamp is stored but is not part of the key, so a redelivery carrying a different timestamp is still absorbed as a conflict.

### 19.5 Upload and export security

`SC-15` Contact imports must enforce an allow-list of file types (CSV, XLSX), a maximum file size, and a maximum row count, all configurable. The npm `xlsx` package must never be used (unpatched prototype-pollution vulnerability); parsing uses exceljs and papaparse.

`SC-16` Uploaded files must be parsed in a background worker, never in the request handler, and the worker must treat every cell as untrusted text: no cell value may reach a SQL statement other than as a bound parameter, and no cell value may reach a shell command, a file path or an HTTP URL.

`SC-17` On export, any cell whose value begins with `=`, `+`, `-`, `@`, tab or carriage return must be neutralised (prefixed with an apostrophe or written as an explicit text-typed cell) to prevent spreadsheet formula injection on the recipient's machine.

### 19.6 Platform security

`SC-18` All traffic must be HTTPS with a valid certificate and HSTS enabled. Plain HTTP must redirect, and the API must reject non-TLS connections.

`SC-19` Secrets must be supplied to containers through environment variables sourced from a secrets file with restricted file permissions, or a secret manager. No secret may be committed to version control; a pre-commit secret scanner must run.

`SC-20` Container images must be pinned to exact tags (`oven/bun:1.3.14`, never `latest`). Dependency and base-image updates must be reviewed monthly, and any advisory rated high or critical must be patched within 7 days (CITS policy).

`SC-21` Database backups must be encrypted at rest, stored off the application host, and a restore must be tested at least quarterly with the result recorded. An untested backup is treated as no backup.

`SC-22` Enforced opt-out rules are a security control, not only a compliance one: the send path must consult the suppression list at the moment of send, inside the same transaction boundary that claims the message for sending, so that an opt-out recorded mid-campaign takes effect on the remainder of that campaign. The same transaction boundary applies the CITS frequency governor (the per-contact ceiling on marketing messages per rolling period, CITS product policy, suggested default 4 per 30 days per client). See §10 Consent and opt-out.

`SC-23` **Phone-number masking is an access control.** "View full phone numbers" is a distinct permission. A Viewer without it sees numbers masked to the last four digits everywhere — contact lists, contact detail, campaign reports, click reports, the inbox, and every export and report export generated by that user. Masking must be applied server-side: the unmasked value must not be present in the API response and then hidden by the browser. Granting or removing the permission is audit-logged, and any export or report export records whether numbers were unmasked (`AU-1`).

### 19.7 Threat model

| Threat | Realistic path | Primary mitigations |
|---|---|---|
| Compromised Super Admin account | Phishing or password reuse against the one account that can reach every client | `SC-1`, `SC-2`, mandatory second factor for Super Admin, `AU-4` cross-workspace logging visible to clients, session revocation |
| Leaked access token | Token pasted into a log, a screenshot, or an error report; attacker then sends from a client's number | `SC-8`–`SC-11`, scrubbing, reveal-is-audited, rehearsed revocation |
| Cross-tenant exposure via a missing filter | A new route or an ad-hoc report query omits the tenant predicate | `SC-4`, `SC-6` route-exhaustive test suite as a deploy gate |
| Malicious spreadsheet upload | A crafted CSV/XLSX aimed at the parser, at SQL, or at whoever opens the export | `SC-15`–`SC-17`, sandboxed worker, banned `xlsx` package |
| Insider exports a client's full contact list | A legitimately authorised user takes the list to a competitor or a personal device | Contact export and report export are separately audited with row count, filters and unmasked-flag (`AU-1`), export permission is a distinct role capability (§6), `SC-23` masking, volume alerting on unusually large exports |
| Large unapproved send | A Campaign Manager launches a campaign far above the intended audience | Campaign approval threshold (default 1,000 recipients) forces `pending_approval` and a Client Admin or Super Admin decision; typed-confirmation threshold (default 500) forces the campaign name to be typed; both audited (`AU-1`, Campaigns) |
| Silent suppression of a paging alert | An operator mutes a class and forgets, so an enforcement notice goes unseen | `AU-17` — only a Super Admin may mute a paging class, with a reason, a maximum 30-day expiry, an audit entry and a standing banner |

---

## 20. Compliance

### 20.1 What Meta requires

`CO-1` Business-initiated messaging requires opt-in. Meta's policy is that a business may contact a person only if the person gave the business their mobile number **and** the business received opt-in permission confirming the person wishes to receive subsequent messages or calls. Possessing a number is not consent. The 24-hour customer service window is a genuine exception: replying to a user's own message within 24 hours does not require prior opt-in, so the consent gate must apply to business-initiated sends only and must never block a legitimate inbound reply.

`CO-2` Opt-outs made **on or off** WhatsApp must both be honoured. Suppression therefore cannot be driven only by WhatsApp-inbound events; the product must accept manually recorded off-platform opt-outs with a reason and a source. See §10.

`CO-3` The product must never cite a version or effective date for WhatsApp's Business Messaging Policy. The policy page carries no version stamp and no effective date, and reserves the right to change without notice. Compliance copy in the UI must link to the policy rather than quote a dated version.

`CO-4` The enforcement ladder must be modelled explicitly, because each rung has a different operational consequence: **warning → a 1–3 day restriction → a 5, 7 or 30 day block on all messaging → an indefinite account lock → permanent removal from WhatsApp products**. Appeals are reviewed in 24–48 hours and not all violations are appealable. Certain categories cause immediate removal with no ladder.

`CO-5` The system must subscribe to the `account_update` webhook and treat it as the authoritative real-time source of enforcement notices, recording the restriction type and end time and raising a paging notification (`AU-9`), routed to Super Admins only where the notice is portfolio-level (`AU-14`).

`CO-6` Because the whole business runs inside one CITS business portfolio, an enforcement action reaches every client at once. The compliance screen must state this plainly to the operator, and consent evidence must be exportable per client because it is the main defence in an appeal decided within 24–48 hours.

### 20.2 India: DPDP Act 2023 and DPDP Rules 2025

`CO-7` Posture, stated plainly: the DPDP Act 2023 is on the statute book and the DPDP Rules 2025 were notified in November 2025 with **phased commencement**. The operational obligations — notice, security safeguards, breach reporting, erasure, published contact details, and rights and grievance handling — commence in **May 2027**. CITS is therefore **not exposed to DPDP penalties today**. The goal is to be compliant on the day the obligations commence by building them in now rather than retrofitting a live system with real client data in it.

**[Verify before build]** The exact commencement dates (13 versus 14 May 2027, and the November 2026 consent-manager date) differ between law-firm summaries, and the official gazette PDF could not be retrieved. Confirm against the gazette before any date is written into a client contract.

`CO-8` Build toward these obligations:

| Obligation | What to build |
|---|---|
| Itemised notice | A plain-language notice, presented independently of other terms, itemising what personal data is processed and for what purposes, with links to withdraw consent, exercise rights and complain to the Data Protection Board |
| Security safeguards | Encryption, masking or tokenisation of personal data (`SC-23`); access control; **access logs retained at least one year** (`AU-6`); log monitoring; business continuity; contractual flow-down to processors |
| Breach reporting | Notify affected people **without delay**, give the Board an initial intimation without delay and a **detailed report within 72 hours**. There is **no materiality threshold** — every breach is reportable, which is stricter than GDPR's risk-based trigger. A breach runbook with a pre-drafted notice template must exist before launch |
| Erasure | Delete or redact personal data once the purpose it was collected for is served, per the retention schedule in `CO-13`, and record the erasure under `AU-4a` |
| Published contacts | Publish contact details for data-protection queries prominently, and surface them in the app |
| Rights and grievance | A documented procedure for rights requests with identity verification and a published response timeline |

### 20.3 TRAI and DLT

`CO-9` **TRAI's TCCCPR and DLT registration do not apply to WhatsApp messaging, and the product must not implement them.** The regulation binds "Access Providers" — licensed telecom operators under Department of Telecommunications licences. Over-the-top messaging apps such as WhatsApp fall outside its scope, and the February 2025 amendments did not bring them in. DLT sender-ID and template registration are SMS and voice obligations. This is stated definitively here because Indian businesses routinely assume the two regimes are the same, and clients will ask.

`CO-10` If CITS ever adds an SMS or voice channel (out of scope for v1, see §23), DLT registration applies **to that leg only** and must be scoped as separate work.

### 20.4 Data residency

`CO-11` No general Indian data-localisation mandate applies to this business today. Meta nonetheless offers Cloud API local storage, selected **per phone number at registration** through the `data_localization_region` field, and **India is a supported region**; the default is the United States. The system must set this to `IN` for every India-facing number at registration time, and the sender-onboarding checklist must treat it as mandatory (see §7). A change of data-localization region consumes one attempt from **each** of the registration and deregistration counters (§7), and the change is audit-logged.

`CO-12` Honest limitation to disclose to clients: **contact-book phone numbers are stored on Meta's servers regardless of the local-storage setting.** Local storage governs message content, not the fact that a number was contacted. Do not tell a client their data never leaves India.

### 20.5 Retention — Meta is not the system of record

`CO-13` Meta retains message content for a **maximum of 30 days**, for retransmission and base functionality. The platform is therefore not a record-keeping system, and CITS must persist its own evidence. Retention periods below are CITS policy, set to satisfy DPDP storage limitation while surviving an appeal window and a full membership or conference cycle.

| Record | Retained | Rationale |
|---|---|---|
| Opt-in evidence (number, UTC timestamp, source type, verbatim consent wording, sender name shown, categories, IP and user agent) | Life of the relationship + 3 years, then **redacted, not deleted** — direct identifiers are cleared and the record is kept as a dated, non-identifying attestation that consent existed, with its wording and source | Primary defence in a Meta appeal and under DPDP/GDPR; deleting it outright destroys the only proof CITS ever had permission |
| Opt-out records | **Indefinite** | An erased opt-out is an opt-out that can be violated again |
| Suppression list entries | **Indefinite** | Same |
| Template versions as sent (`template_version_id`) | 3 years | Reconstructing what a person actually received |
| Personalisation values substituted into a send | 12 months | The only copy of the delivered content once Meta's 30 days lapse |
| Delivery and read receipts | 24 months | Reporting and dispute resolution |
| Click-event logs (short-link click records: contact, campaign, link, UTC timestamp, IP, user agent) | 12 months, then aggregated to counts with the per-contact rows deleted | Click events are personal data — they reveal an identified individual's behaviour — so they cannot sit in the system indefinitely; the campaign's click totals survive as aggregates |
| Audit log | 7 years (`AU-6`) | Exceeds the one-year access-log floor |

`CO-13a` **Contact erasure does not erase consent history.** When a contact is erased under a rights request, the contact record, its click events and its personalisation values are removed or redacted, but the redacted opt-in record described above and any opt-out or suppression entry survive. The surviving record must be non-identifying beyond what is needed to defend an appeal, and the erasure itself is audit-logged under `AU-4a` recording which fields were redacted. Suppression must survive erasure absolutely: erasing a contact must never make it possible to message that number again.

`CO-14` Deletion and redaction must be automated as a scheduled job, must log what it processed in aggregate, and must be verifiable — an unenforced retention policy is worse than none, because it is a documented promise the organisation is breaking.

### 20.6 Controller and processor roles

`CO-15` Two layers must be documented. Meta's own Business Data Processing Terms make **the business the controller and WhatsApp the processor**, with Meta companies as authorised sub-processors. Where CITS sends on behalf of a society, journal, conference or university, **the client is the controller and CITS is the processor**.

`CO-16` Each client agreement must therefore include a data processing agreement covering: processing only on documented instructions; confidentiality obligations on staff; security measures; sub-processor authorisation **naming Meta and WhatsApp explicitly** (and any future BSP); assistance with data-subject rights requests and with breach notification; deletion or return of data at the end of the engagement; and a right of audit.

`CO-17` Each client agreement must also include a **client warranty** that the contact list was lawfully collected with consent covering WhatsApp as a channel, and an **indemnity for list provenance**. This is the single most valuable commercial protection in the contract: CITS cannot verify how a society assembled a membership list built over twenty years.

`CO-18` These obligations apply even though v1 is internal-use-only with no client billing. The absence of an invoice does not change the fact that CITS is processing another organisation's personal data.

### 20.7 European and UK recipients

`CO-19` Conference delegates, journal authors and peer reviewers are frequently in Europe and the UK. There, marketing messages require **prior consent**; legitimate interest is not a safe legal basis for cold outreach, and a narrow "soft opt-in" applies only where the contact details were obtained in the context of selling something to that same person. Every message must carry a free and simple way to opt out — the mechanism CITS provides is described in §10, and it must never be presented in the product as a Meta requirement.

`CO-20` The data model must support **region-aware consent rules keyed on the country of the phone number**, so that a contact with a European or UK number is held to the stricter standard automatically and cannot be included in a marketing campaign without a recorded prior consent. See §8 Contacts and §10 Consent.

### 20.8 Children's data

`CO-21` Universities and student-member societies mean some contacts may be minors, which triggers materially stricter consent obligations under DPDP — including verifiable parental consent — and heavier penalties. This section does not resolve it. The requirement for v1 is to **assess and record the exposure**: the client onboarding questionnaire must ask whether the list may contain people under 18, the answer must be stored on the client record, and any "yes" must raise a flag requiring legal review before that client's first campaign. Treat a resolution as a v2 workstream (see §24 Roadmap), not a solved problem.

---

## 21. Data model

### 21.1 How to read this section

Every entity below is described as a plain-English table: what it is for, its key fields, which column scopes it to a client, and how it relates to other entities. There is no SQL here — a developer or an AI coding tool should be able to generate Drizzle schema and migrations directly from these descriptions. Field types are named in words (text, integer, timestamp with time zone, JSON, boolean, enumerated list).

Three conventions apply everywhere:

- Every table has a surrogate primary key (UUID), a `created_at` and, unless the table is append-only, an `updated_at`, both stored in UTC.
- Every timestamp coming from Meta is stored twice: the provider timestamp as sent, and our own `received_at`. Webhook ordering is not guaranteed (see §13 Sending engine), so we never trust arrival order.
- Money is stored as an integer in the smallest currency unit (paise for INR) plus a currency code. Never floating point.

**DM-1.** The system must store all timestamps in UTC with time-zone-aware columns, and must render them in Asia/Kolkata in the interface.

**DM-2.** The system must store all monetary amounts as integers in the smallest currency unit together with an ISO-4217 currency code, and must never store money as a floating-point number.

### 21.2 Platform and account entities

| Entity | Purpose | Key fields | Tenant scope | Relationships and constraints |
|---|---|---|---|---|
| `business_portfolio` | The CITS Meta business portfolio. Messaging limits, volume tiers and pacing state live here — **not** on the phone number. | Meta business portfolio ID (unique), display name, business-verification status, current messaging limit tier (250 / 2,000 / 10,000 / 100,000 / unlimited), tier source, tier observed-at, phone-number capacity (2 before verification, 20 after), template-messages-sent-in-rolling-365-days count, count-observed-at, portfolio pacing state, enforcement state | **Not client-scoped** — deliberately | Parent of all WABAs. One row in v1. The rolling-365-day count is live data read from Meta, never an assumed figure (see §21.2 note below). |
| `whatsapp_business_account` | A WABA owned by the CITS portfolio. Templates live here. | Meta WABA ID (unique), name, timezone, currency, account review status, business portfolio ID, template count per language, template quota | Not client-scoped | Belongs to exactly one `business_portfolio`. A WABA can never be moved to another portfolio — the column must be immutable after insert. Every `template` belongs to a WABA, not to a sender number. |
| `client` | A CITS customer organisation and the tenant boundary — a workspace. | Name, slug, contact person, status (`onboarding` / `active` / `paused` / `suspended` / `archived`), status-changed-at, status-changed-by, default language, notes, onboarding checklist state | **Is the tenant** | Referenced by nearly every other table. Maps to a Better Auth Organization; store the organization ID here. |
| `user` | A person who can sign in. Owned by Better Auth. | Email, name, password/credential fields, MFA state, last sign-in, **`super_admin` flag** | Not client-scoped (a user may serve several clients) | The application-level **Super Admin** role lives here, on the user record, and nowhere else. Workspace roles are held through `user_client_role`. |
| `user_client_role` | Grants one user one workspace role inside one client. | User ID, client ID, role (`client_admin` / `campaign_manager` / `inbox_agent` / `viewer`, see §6), granted-by user, granted-at, revoked-at | Client ID | Unique on (user, client) where not revoked. There is no cross-workspace operator role: a CITS campaign operator is simply a user holding **Campaign Manager** in several workspaces, which is several rows here. |
| `user_client_permission` | Named extra permissions granted on top of a workspace role. | User ID, client ID, permission key, granted-by, granted-at, revoked-at | Client ID | Unique on (user, client, permission key) where not revoked. v1 defines one key: **`view_full_phone_numbers`**. Viewers see phone numbers masked to the last four digits unless they hold it. |
| `sender_number` | One WhatsApp business phone number, dedicated to one client. | Meta phone number ID (unique), WABA ID, display phone number in E.164, display name, `name_status`, registration status, `data_localization_region` (IN for all India-facing numbers), quality rating (green / yellow / red / unknown), quality observed-at, throughput level (messages per second) and observed-at, connection status (connected / restricted), 2SV PIN reference (never the PIN itself), MM Lite onboarding state, **registration-attempt counter and window start, deregistration-attempt counter and window start** | Client ID | Belongs to one `whatsapp_business_account` and one `client`. Unique on Meta phone number ID. **This table carries no messaging limit and no volume tier** — both are read from `business_portfolio`. The two attempt counters are independent, each capped at 10 per rolling 72 hours (see DM-21). |
| `access_token` | A credential for calling Meta on behalf of a WABA or number. | Scope (waba / phone_number), target ID, encrypted token value (variable length, envelope-encrypted), key version, label, expires-at if known, last-verified-at, last-health-check-at, revoked-at | Not client-scoped; joined via the WABA or number | One active row per target. Tokens are opaque strings — never parsed, never logged, never returned by any API response. Health is re-checked every 6 hours (see §21.6 settings). Whether business tokens expire is not documented — **[Verify before build]** — so the model carries a nullable expiry and a mandatory re-auth path. |

**DM-3.** The system must record the messaging limit tier, volume-tier accumulation and pacing state on `business_portfolio`, and must never store a messaging limit or a volume tier on `sender_number`. Since 2025-10-07 Meta calculates these at portfolio level and shares them across every number in the portfolio; modelling them per number would make every capacity calculation wrong. Every screen that displays a limit for a number must read it from the portfolio row.

**DM-4.** The system must treat `whatsapp_business_account.business_portfolio_id` as immutable after creation, because a WABA cannot be migrated between portfolios. A client's number can therefore never be handed over to that client.

**DM-21.** The system must maintain two independent counters on `sender_number` — registration attempts and deregistration attempts — each over a rolling 72-hour window. A data-localization-region change consumes one from each. The system must refuse the **eighth** attempt in either counter unless an operator types an explicit confirmation, and must refuse the **eleventh** in either counter unconditionally.

**Note on the rolling-365-day count.** Portfolio pacing applies below 500,000 template messages in a rolling 365 days. At CITS's year-one ceiling of just under 50,000 a month the portfolio sits inside that regime for roughly the first ten months, so pacing is the **default** state in year one. The stored count must be refreshed from Meta and read as live data, never assumed.

### 21.3 Contacts, consent and suppression

| Entity | Purpose | Key fields | Tenant scope | Relationships and constraints |
|---|---|---|---|---|
| `contact` | A person a client may message. | Phone number in E.164 (normalised), original raw input as supplied, country code, first name, last name, **member ID** (the client's own membership or registration number), **designation**, **organization or institution**, **city**, **state**, **contact type ID** (foreign key to `contact_type`), email, language, **notes** (free text), **deliverability state** (`unknown` / `deliverable` / `suspect` / `invalid`), deliverability-changed-at and changed-by, **archived flag** and archived-at, custom attributes (JSON, for genuinely client-specific extras only), source, marketing-consent state (derived), first-seen, last-inbound-at, last-outbound-at, lifetime message counts, 131026 occurrence count with distinct-campaign and distinct-day tallies | Client ID | Unique on (client ID, normalised phone number). **Contact type is a real column referencing a managed per-workspace list — it must not live in the custom-attributes bag.** Member ID, designation, organization, city and state are real columns because they are filterable, importable and template-personalisable. |
| `contact_type` | The managed per-workspace list of contact types (for example member, delegate, subscriber, faculty). | Name, description, sort order, active flag | Client ID | Unique on (client ID, lowercased name). Editable by a Client Admin without a deploy. A type in use cannot be deleted, only deactivated. |
| `contact_group` | A named **static** list with explicit membership. | Name, description, cached member count, last-recount-at | Client ID | There is no `type` column and no `dynamic` variant. Membership is only ever explicit rows in `contact_group_member`. |
| `contact_group_member` | Membership of a static group. | Group ID, contact ID, added-by, added-at | Client ID (denormalised for query scoping) | Unique on (group ID, contact ID). |
| `saved_segment` | A stored filter definition, resolved to contacts at the moment it is used. A separate entity from `contact_group`, and in v1. | Name, description, filter definition (JSON), created-by, last-used-at, last-resolved count and resolved-at (cached for display only, never authoritative) | Client ID | Unique on (client ID, lowercased name). Resolution happens at use time; the cached count is advisory. A campaign built from a segment stores the resolved contacts in `campaign_audience_snapshot`, never a live reference. |
| `tag` | A short label. | Name, colour | Client ID | Unique on (client ID, lowercased name). |
| `contact_tag` | Applies a tag to a contact. | Tag ID, contact ID, applied-by | Client ID | Unique on (tag ID, contact ID). |
| `consent_record` | Append-only evidence of an opt-in or opt-out. | Contact ID, phone number as recorded, direction (opt_in / opt_out), category (marketing / utility / authentication / all), verbatim consent wording shown, business name shown, channel disclosure text, source type (`website_form` / `sms` / `ivr` / `paper` / `import` / `inbound_reply` / `opt_out_button` / `user_preferences_webhook` / `error_131050` / `off_platform_request`), source reference (URL, form ID, file name), IP address, user agent, recorded-by user, occurred-at | Client ID | Append-only. Never updated, never deleted. The contact's current consent state is derived from the latest record per category. `website_form` means consent was collected on the **client's own** website and imported with the contact — CITS hosts no public opt-in form in v1. |
| `suppression_entry` | A phone number that must never receive a business-initiated message from any CITS client. | Normalised phone number (unique), reason, source, first-suppressed-at, last-reconfirmed-at, notes, originating client ID (informational only) | **Deliberately not client-scoped** | Checked on every send. See 21.8. |
| `meta_block_entry` | A user blocked on Meta's side for one sender number. | Sender number ID, contact phone number, state (blocked / unblocked / failed), blocked-at, unblocked-at, last error code | Client ID | Unique on (sender number ID, phone number). Distinct from suppression — see below. |
| `frequency_ledger_entry` | One marketing message counted against the CITS-side frequency governor. | Contact ID, client ID, campaign ID, counted-at | Client ID | Append-only. Read by the pre-send suppression check to enforce the per-contact marketing ceiling (see §21.6). |

**DM-5.** The system must store phone numbers in E.164 form, normalised with libphonenumber-js at ingest, and must retain the raw input string exactly as supplied for audit and error reporting.

**DM-6.** The system must never delete or update rows in `consent_record`. A withdrawal is a new row, not an edit.

**DM-22.** The system must set `contact.deliverability_state` to `invalid` **only** on syntactic validation failure of the number. Delivery evidence must never set `invalid`. Repeated error 131026 sets `suspect`, and only after **N** occurrences across at least **M** distinct campaigns and at least **D** distinct calendar days (CITS product policy; defaults N=3, M=2, D=2, all configurable per workspace). The state must be reversible by an operator, and every change must be audit-logged with the actor and reason.

**DM-23.** The system must store contact type as a foreign key to the per-workspace `contact_type` list, and must not accept a free-text type or a type held in the custom-attributes JSON.

**Why suppression and Meta blocking are two tables.** A suppression entry is a CITS-side promise: this human asked not to be contacted, so we will not send. It is unbounded in size, applies before any API call, and applies across every client because the obligation is owed to the person, not to a customer of ours. A Meta block entry is a platform-side action on one sender number: it stops that number receiving messages from that user, it is capped at 64,000 users per number, it can only be applied to someone who messaged the business in the last 24 hours, and it is applied in batches of at most 1,000. They have different owners, different lifetimes and different failure modes. Collapsing them would either cap our suppression list at 64,000 or make an unenforceable promise. See §10 Consent and opt-out for the write rules.

### 21.4 Templates, campaigns and messages

| Entity | Purpose | Key fields | Tenant scope | Relationships |
|---|---|---|---|---|
| `template` | A logical template as CITS manages it. Owned by one client, living on exactly one WABA. | WABA ID, name (lowercase, underscores), language, category (marketing / utility / authentication), current status (`APPROVED` / `PENDING` / `PAUSED` / `DISABLED` / `REJECTED`), current quality score, `correct_category` as last reported by Meta, pause count, paused-until, Meta template ID, send path (cloud_api / marketing_messages) | Client ID | Unique on (WABA ID, name, language) — Meta's name-uniqueness rule and the 250/6,000 ceiling are **per WABA per language**. A template is usable by any sender number attached to its WABA. Status and quality are separate dimensions and must not be merged into one column. |
| `template_version` | An immutable snapshot of one submitted body. | Template ID, version number, components (JSON: header, body, footer, buttons), parameter format (named / positional), sample values, submitted-at, review outcome, rejection reason, rejection recommendation text, approved-at, language | Client ID | Append-only. The version actually used is recorded on every campaign recipient and every message. |
| `campaign` | One planned outbound send. | Name, campaign type ID (foreign key to `campaign_type`), sender number ID, template version ID, send path discriminator, optimisation spec (JSON, nullable), scheduled-at, state (`draft` / `pending_approval` / `queued` / `scheduled` / `running` / `paused` / `completed` / `partially_delivered` / `stopped_by_meta` / `failed` / `cancelled`), state-changed-at, pause reason, **approval-requested-by, approval-requested-at, approved-by, approved-at, approval-note**, typed-confirmation-given-by and at, counts by status, dropped-by-pacing count, blocked-by-frequency-cap count, cost estimate, cost actual | Client ID | Approval fields are non-null only once the recipient count reached the campaign approval threshold. `halted` and `blocked_by_client_status` are **not** states: a campaign blocked by client suspension stays `scheduled` and is refused at pre-flight, with the refusal recorded in `audit_log`. |
| `campaign_audience_snapshot` | Frozen record of who the audience was and how it was chosen. | Campaign ID, filter definition (JSON), group IDs, saved segment IDs, resolved contact count, suppressed count, frequency-capped count, snapshot-taken-at | Client ID | Append-only. Makes a campaign reproducible and auditable after groups, segments and filters change. |
| `campaign_recipient` | One intended send. Doubles as the send outbox. | Campaign ID, contact ID, **template version ID**, **attempt key**, resolved parameter values (JSON), state (pending / queued / accepted / held / sent / delivered / read / failed / skipped), skip reason, error code, message ID, `send_id` used as `biz_opaque_callback_data`, first-queued-at, last-attempt-at | Client ID | Unique on (**campaign ID, contact ID, template version ID, attempt key**). This constraint is what prevents double-sending. The template **version** id is used deliberately — the mutable template id would let an edit silently collide with an earlier send. |
| `message` | A single WhatsApp message in either direction. | Sender number ID, contact ID, direction, wamid (Meta message ID), `send_id`, campaign recipient ID (nullable), conversation ID, type, content or template reference, template version ID, media reference, current status, current status rank, pricing category, billable flag, sent-at, failed error code and API surface | Client ID | Unique on wamid where wamid is present. `current_status` is derived, never written directly by a webhook handler. |
| `message_status_event` | Append-only log of every status webhook. | Message ID, wamid, status (sent / delivered / read / failed / played), provider timestamp, received-at, error code, API surface, raw payload (JSON), payload hash | Client ID | Unique on (**wamid, status**) only. The provider timestamp is stored but is deliberately **not** part of the key, so a redelivery carrying a different timestamp is still absorbed as a conflict. |
| `conversation` | A thread between one sender number and one contact. | Sender number ID, contact ID, state (`open` / `closed`), state-changed-at and by, assigned user, last inbound-at, last outbound-at, unread count | Client ID | Unique on (sender number ID, contact ID). Exactly two states — there is no `snoozed`. There is no subject and no per-conversation label set in v1; categorisation is done with contact tags, which already exist and are filterable. |
| `conversation_note` | Internal note, not sent to the user. | Conversation ID, author, body, created-at | Client ID | — |
| `customer_service_window` | Tracks the 24-hour free-form window per pairing. | Sender number ID, contact ID, opened-at, expires-at, opened-by (inbound message / inbound call), Meta conversation ID, free-entry-point flag | Client ID | Unique on (sender number ID, contact ID). Updated on every inbound; the composer reads it to decide whether free-form is possible. |

**DM-7.** The system must derive a message's current status by monotonic rank (sent 1, delivered 2, read 3, played 4) and must never regress a message from a higher rank to a lower one. `failed` is terminal but must not overwrite `read` or `played`.

**DM-8.** The system must record `held_for_quality_assessment` as its own state on `campaign_recipient`, must never count it as sent, and must never retry it.

**DM-24. Definition of `attempt_key`.** `attempt_key` is an integer starting at 1. It is incremented **only** by an explicit operator-initiated retry of a specific recipient set. Automatic retries inside the error-handling policy reuse the same `attempt_key` and are therefore idempotent against the outbox constraint. An operator retry creates new `campaign_recipient` rows under attempt_key + 1 inside the same campaign, and those rows appear in the same campaign report as a separate attempt rather than as a new campaign.

**DM-25. Campaign approval.** The system must move a campaign to `pending_approval` on submit when its final recipient count is at or above the workspace's campaign approval threshold, must permit `scheduled` or `running` only after a **Client Admin** or **Super Admin** approves it, and must record approval-requested-by, approval-requested-at, approved-by, approved-at and approval-note on the campaign row. Approval requests and decisions must raise notifications and be written to `audit_log`.

**DM-26. Template status gate.** The system must allow a campaign to be created and scheduled against a `PENDING` template, with a warning stored on the campaign. The sending engine must refuse to release any message whose template is not `APPROVED` for the exact language being sent. `PAUSED`, `DISABLED` and `REJECTED` templates must be visible in the picker but unselectable.

### 21.5 Import, click tracking, usage and operations

| Entity | Purpose | Key fields | Tenant scope | Relationships |
|---|---|---|---|---|
| `import_job` | One uploaded contact file. | Uploaded-by, file name, file size, row count, state, counts (created / updated / skipped / errored), mapping definition (JSON), started-at, finished-at, **undo-available-until** (24 hours after completion), undone-at, undone-by | Client ID | The undo window is the only rollback that exists. |
| `import_error` | One rejected row. | Import job ID, row number, raw row (JSON), error type, error message | Client ID | Append-only. |
| `import_created_contact` | Link from an import job to each contact it **created** (not updated). | Import job ID, contact ID, created-at | Client ID | Append-only. Exists solely so "undo import" can identify its own creations. |
| `click_link` | A trackable destination inside a template. | Campaign ID, template version ID, destination URL, UTM parameters, short domain, created-at | Client ID | — |
| `click_event` | One redirect served. | Click link ID, token, message ID, wamid, contact ID, clicked-at, user agent, coarse IP (see §19) | Client ID | Append-only. |
| `usage_record` | One billable or free unit of consumption, attributed to a client. | Message ID, sender number ID, pricing category, billable flag, rate card entry ID, unit cost in paise, margin config entry ID, margin amount, GST amount, total, incurred-at, source (webhook pricing object / reconciliation) | Client ID | Append-only. Unique on message ID. |
| `rate_card` | A dated set of Meta rates. | Region/market, currency, effective-from, effective-to, source (rate card CSV file name and download date), notes | **Not client-scoped** | — |
| `rate_card_entry` | One rate within a card. | Rate card ID, category, in-window flag, tier lower bound, tier upper bound, unit price in paise | Not client-scoped | Unique on (rate card, category, in-window flag, tier lower bound). India rate values are **[Verify before build]** — the numerals are secondary transcription and must be re-read from the INR rate-card CSV before any figure is shown to a client. |
| `margin_config` | A dated set of CITS service charges layered on top of Meta cost. Versioned by effective date exactly like `rate_card`. | Effective-from, effective-to, label, created-by, notes, scope (platform default / one client) and client ID when scoped | Nullable client ID — platform default when null | Only one config may be effective at a time for a given scope. Never edited after it has priced a `usage_record`; a change is a new row with a new effective-from. |
| `margin_config_entry` | One charge rule within a margin config. | Margin config ID, pricing category, charge type (percentage / fixed per message), value, minimum charge in paise, maximum charge in paise | Follows parent | Unique on (margin config, pricing category). `usage_record` stores the entry ID actually applied, so an old invoice always reprices identically. |
| `audit_log` | Who did what. | Actor user ID, actor type (user / system / webhook), action, entity type, entity ID, before/after summary (JSON, secrets redacted), IP, user agent, occurred-at | Client ID, nullable for platform-level actions | Append-only. |
| `webhook_event` | Raw, durable capture of every inbound webhook. | Received-at, signature verified flag, object type, WABA ID, field, raw body (text, exactly as received), body hash, processing state, processing attempts, last error | Not client-scoped at write time; resolved client ID stored once known | Unique on body hash within a rolling window. Written before any parsing, so a parser bug never loses data. |
| `notification` | An alert to a CITS user. | Recipient user ID, severity, category, title, body, related entity, delivered channels, read-at | Client ID nullable | Recipients for each category come from `notification_recipient` (see §21.6). |
| `error_code_classification` | Meta error codes as editable data, keyed on the API surface and the code together. | **API surface** (`/messages`, `/block_users`, `/message_templates`, …), **code**, subcode, title, class (`RETRY_BACKOFF` / `TERMINAL` / `CONDITIONAL` / `PROBABLE_INVALID_CONTACT` / `OPERATIONAL_ALERT`), retry policy (JSON), user-facing explanation, counts-toward-131026-evidence flag, updated-at | **Not client-scoped** | Unique on (**api_surface, code, subcode**) — never on code alone. Loaded as seed data from the table in §13. Must be editable without a deploy. |

**DM-9.** The system must persist the raw webhook body and its signature-verification result before any parsing, and must acknowledge Meta with HTTP 200 within the acknowledgement budget defined in §13.

**DM-10.** The system must store Meta error-code behaviour in `error_code_classification` as data. Retry and suppression behaviour must never be hard-coded in application logic.

**DM-27.** The system must look up error behaviour by the pair **(api_surface, code)** and must never look up by code alone, because Meta reuses codes across endpoints with different meanings: 131047 means "customer service window expired" on `/messages` but "target has not messaged in 24 hours" on `/block_users`; 130429 means throughput ceiling on `/messages` but request rate limit on `/block_users`; 131021 means sender equals recipient on `/messages` but self-block on `/block_users`. Every error captured on `message`, `message_status_event` and `campaign_recipient` must therefore store the API surface alongside the code.

**DM-28. Undo import.** The system must offer an "undo import" for 24 hours after an import completes. It must delete only contacts recorded in `import_created_contact` for that job which have not since been messaged and have not replied. It must never reverse an opt-out, never revert updates made to pre-existing contacts, and must write an `audit_log` entry naming the job, the actor and the number of contacts removed. There is no general import rollback.

**DM-29. Margin versioning.** The system must version service charges by effective date in `margin_config` / `margin_config_entry`, must record on each `usage_record` the exact entry that priced it, and must never mutate a config that has already priced a usage record.

### 21.6 Configuration and settings

Roughly a dozen requirements elsewhere in this document promise that something is "configurable without a deploy". This is where those values live. Nothing that is promised as configurable may be a constant in application code.

| Entity | Purpose | Key fields | Tenant scope | Notes |
|---|---|---|---|---|
| `platform_setting` | The platform-wide default for every named setting. | Setting key, value type (integer / decimal / boolean / text / duration / time-of-day / JSON), value, description, minimum, maximum, updated-by, updated-at | **Not client-scoped** | One row per key. Editable by a Super Admin only. |
| `workspace_setting` | A per-workspace override of a named setting. | Client ID, setting key, value, set-by, set-at | Client ID | Unique on (client ID, setting key). Absence of a row means the platform default applies. Values are validated against the type, minimum and maximum on `platform_setting` at write time. |
| `campaign_type` | The managed per-workspace list of campaign types. | Name, description, sort order, active flag | Client ID | Unique on (client ID, lowercased name). Referenced by `campaign`. |
| `opt_out_keyword` | Words that, received inbound, are treated as an opt-out or an opt-in. | Client ID, keyword (lowercased, trimmed), direction (opt_out / opt_in), language, active flag | Client ID | Unique on (client ID, keyword, language). Seeded with a platform default list; a Client Admin may add to it. |
| `internal_test_number` | Numbers that may be messaged outside normal campaign flow for testing. | Client ID, phone number in E.164, label, added-by, added-at | Client ID | Unique on (client ID, phone number). Sends to these numbers are marked as tests and excluded from campaign reporting. |
| `quiet_hours_window` | A window during which the workspace chooses not to release campaign messages. | Client ID, day-of-week set, start time, end time, timezone (default Asia/Kolkata), active flag | Client ID | **CITS product policy and entirely optional — quiet hours are not a Meta rule.** A workspace with no rows here has no quiet hours. |
| `notification_recipient` | Who receives which alert category, on which channel. | Client ID (nullable for platform alerts), notification category, user ID or external address, channel (in-app / email), active flag | Client ID nullable | Unique on (scope, category, recipient, channel). |
| `quick_reply` | Saved canned response for the inbox. | Title, shortcut, body, category, active flag | Client ID | Unique on (client ID, shortcut). |
| `conversational_component` | Per-number conversational configuration (welcome message, ice-breakers, commands) as CITS holds it. | Sender number ID, component type, payload (JSON), enabled flag, last-synced-to-Meta-at, last-sync-error | Client ID | One row per (sender number, component type). Held locally so the configuration is editable and auditable independently of Meta's copy. |
| `click_tracking_config` | Click-tracking settings including the fallback destination. | Client ID, short domain, **fallback URL** used when a token is unknown or expired, link expiry in days, active flag | Client ID | One row per client. The fallback URL must be a valid absolute URL and must never be blank. |

Named settings carried in `platform_setting` / `workspace_setting`, with their canon defaults:

| Setting key | Type | Default | Meaning |
|---|---|---|---|
| `typed_confirmation_threshold` | integer, recipients | **500** | Above this count, launching a campaign requires typing the campaign name. CITS product policy, not a Meta rule. |
| `campaign_approval_threshold` | integer, recipients | **1,000** | At or above this count, launching additionally requires approval by a Client Admin or Super Admin. CITS product policy, not a Meta rule. |
| `frequency_governor_ceiling` | integer, messages | **4** | CITS-side maximum marketing messages per contact per rolling period, per client. Independent of Meta's per-user cap. |
| `frequency_governor_period_days` | integer, days | **30** | The rolling period for the ceiling above. |
| `unresolved_send_age` | duration | **6 hours** | Single value used identically by the reconciliation sweep, the dashboard tile and the alert. |
| `reply_attribution_window` | duration | **7 days** | CITS product policy. Single value used identically by inbox attribution and by campaign "Replied" and "Opted out" counts. |
| `token_health_check_cadence` | duration | **6 hours** | How often stored access tokens are re-verified. |
| `deliverability_suspect_n` / `_m` / `_d` | integers | **3 / 2 / 2** | Occurrences of error 131026, distinct campaigns, distinct calendar days required before a contact becomes `suspect`. |

**DM-30.** The system must resolve every configurable value as: workspace override if present, otherwise platform default. No configurable value may be a literal in application code, and no screen may display a threshold it did not read from this resolution.

**DM-31.** The system must refuse to set `campaign_approval_threshold` below the effective `typed_confirmation_threshold` for the same workspace, at both platform and workspace level, and must state the reason in the validation message.

**DM-32.** The system must record every settings change in `audit_log` with the key, the old value, the new value and the actor.

**DM-33.** The CITS-side frequency governor must be enforced in the pre-send suppression check using `frequency_ledger_entry`, and messages it excludes must be surfaced in the pre-flight summary as their own named exclusion reason, separate from suppression, consent and deliverability exclusions.

### 21.7 Tenant scoping rule

**DM-11.** Every tenant-owned table must carry a non-null `client_id` column, and every query touching a tenant-owned table must be scoped by it.

**DM-12.** Tenant isolation must be enforced in the database, not only in application code. The system must use PostgreSQL row-level security with a session-scoped client identifier, or a mandatory query helper that cannot be bypassed. Application-code-only scoping is a hard fail at review.

**DM-13.** The system must never build SQL by string interpolation. Drizzle's `sql` template must only receive parameterised values, and the pinned version must be 0.45.2 or later.

Denormalising `client_id` onto join tables such as `contact_group_member` and `contact_tag` is deliberate. It costs one column and removes the need for a join in every isolation predicate, which is exactly the kind of shortcut that gets skipped under deadline pressure.

Five table families are deliberately **not** client-scoped:

| Table | Why the exception is correct |
|---|---|
| `suppression_entry` | The duty not to contact is owed to the person, not to one client. A recipient who opts out of a journal's messages must not receive a conference invitation from a different CITS client the following week. Scoping this per client would recreate exactly the harm the list exists to prevent. |
| `business_portfolio`, `whatsapp_business_account` | These are CITS assets, shared by every client. Messaging limits, volume-tier accumulation and portfolio pacing are computed across all of them jointly. A per-client copy would be a lie about how Meta actually behaves. |
| `rate_card`, `rate_card_entry` | Meta's rates are a property of market and category, not of a customer. One versioned card serves everyone. |
| `error_code_classification` | Platform behaviour is identical for every client. A per-client copy would drift. |
| `platform_setting` | It is the default layer by definition. Per-client values live in `workspace_setting`, which is scoped. |

`margin_config` is a hybrid: a null client ID means the platform default charge, a non-null client ID means a client-specific charge. It is scoped when scoped and unscoped when not, and the query helper must handle both.

`access_token` and `webhook_event` are also unscoped at rest, but for a different reason: they are reached through a WABA or a number, and the client is derived. `webhook_event` stores the resolved client identifier once parsing succeeds, purely to make debugging queries convenient.

**DM-34.** The `super_admin` flag on `user` must never be used to bypass the row-level-security predicate silently. Super Admin access to a workspace must set the session client identifier explicitly and must write an `audit_log` entry naming the workspace entered.

### 21.8 Uniqueness and integrity constraints that actually matter

| Constraint | Table | Why it exists |
|---|---|---|
| Unique on (client ID, normalised phone number) | `contact` | A client may hold the same person once. Imports rely on this to upsert rather than duplicate. |
| Unique on (campaign ID, contact ID, **template version ID**, attempt key) | `campaign_recipient` | This is the send outbox and the only structural defence against double-sending. Meta offers no idempotency key, so the row must exist and be claimed before the API call. The template **version** id is used because the mutable template id changes under an edit and would let two different bodies collide on one row. A deliberate operator re-send uses attempt key + 1, making the second send visible rather than silent. |
| Unique on (wamid, status) | `message_status_event` | Meta retries webhooks for at least 36 hours and explicitly produces duplicates. The provider timestamp is deliberately excluded from the key so a redelivery with a shifted timestamp still lands as a conflict rather than a second row. |
| Unique on wamid where present | `message` | One Meta message, one row. |
| Unique on (WABA ID, name, language) | `template` | Matches Meta's own rule, which is per WABA per language; a duplicate submission returns error 100 / subcode 2388024, and catching it locally saves an API round trip. |
| Unique on normalised phone number | `suppression_entry` | One number, one suppression. Reason and source accumulate in the notes and in `consent_record`. |
| Unique on (sender number ID, contact ID) | `customer_service_window`, `conversation` | The window and the thread are properties of a pairing, not of a message. |
| Unique on Meta phone number ID | `sender_number` | Prevents the same number being attached to two clients. |
| Unique on (api surface, code, subcode) | `error_code_classification` | Meta reuses codes across endpoints with different meanings; a unique key on code alone would force one of the two meanings to be wrong. |
| Unique on (client ID, setting key) | `workspace_setting` | One override per key per workspace, so resolution is deterministic. |
| Unique on (client ID, lowercased name) | `contact_type`, `campaign_type`, `saved_segment`, `tag` | These are managed pick-lists; duplicates by case are the commonest data-quality failure in them. |

### 21.9 Append-only tables

The following tables must reject updates and deletes at the database level, enforced by a trigger or by revoking UPDATE and DELETE privileges from the application role.

| Table | Why |
|---|---|
| `consent_record` | It is the evidence relied on in a Meta appeal (decided in 24–48 hours) and under DPDP. Evidence that can be edited is not evidence. |
| `message_status_event` | The raw delivery history. The derived status on `message` is the mutable view; the log underneath it is not. |
| `webhook_event` | Durable capture. There is no replay API and no dead-letter queue at Meta, so what we captured is all we will ever have. |
| `audit_log` | An audit trail that the application can rewrite has no value. |
| `usage_record` | It becomes the basis for charging clients later. Corrections are new adjustment rows, never edits. |
| `campaign_audience_snapshot` | Makes an old campaign explainable after groups, segments and filters have changed. |
| `frequency_ledger_entry` | The evidence that the frequency governor was applied correctly. |
| `import_created_contact` | The record of what an import created; the undo path depends on it being unforgeable. |
| `import_error`, `click_event` | Factual event logs; nothing legitimately edits them. |

`margin_config` and `margin_config_entry` are not append-only in the database sense, but DM-29 forbids editing a row that has already priced a `usage_record`; the practical effect is the same and it should be enforced by a check in the write path.

### 21.10 Indexing guidance

Only a handful of query shapes will actually get slow at the scale planned in v1 (under 10 clients, under 50,000 messages per month). Index for those and resist adding more.

| Query | Index |
|---|---|
| Inbox list — open conversations for a client, newest activity first | Composite on (client ID, state, last activity timestamp descending) on `conversation`. Add a partial index filtered to `state = 'open'` if the closed backlog grows large. |
| Conversation thread — messages for one pairing in time order | Composite on (client ID, conversation ID, sent-at descending) on `message`. |
| Campaign status roll-up — counts by state for one campaign | Composite on (campaign ID, state) on `campaign_recipient`. Keep denormalised counters on `campaign` updated by the worker; the index serves drill-down, the counters serve the dashboard. |
| Campaigns awaiting approval | Partial index on `campaign` filtered to `state = 'pending_approval'`, ordered by approval-requested-at. |
| Contact search and filtering | B-tree on (client ID, phone number) for exact lookup; composite on (client ID, contact type ID) and (client ID, city) for the common filters; a trigram index on name for partial search; a GIN index on the custom-attributes JSON only if saved-segment filters actually query it. |
| Saved segment resolution | Served by the contact indexes above; a segment must not get an index of its own. |
| Status-event ingestion | The unique index on (wamid, status) is also the lookup index. A separate index on (message ID, provider timestamp) supports rendering the event history. |
| Suppression check on every send | Unique index on normalised phone number is sufficient; the check is a single point lookup. |
| Frequency governor check on every send | Composite on (client ID, contact ID, counted-at) on `frequency_ledger_entry`. |
| Settings resolution | Covered by the unique index on (client ID, setting key); the platform table is small enough to be cached in memory. |
| Webhook processing backlog | Partial index on `webhook_event` filtered to unprocessed rows. |

**DM-14.** The system must not add an index without a named query it serves. Every index must be recorded in the migration with a one-line comment naming that query.

### 21.11 Retention and deletion

When a client asks for a contact to be erased, the system performs a **redaction**, not a row drop.

**DM-15.** On contact erasure the system must delete or overwrite: the contact's name, member ID, designation, organization, city, state, email, notes, custom attributes, raw imported values, message bodies and personalisation parameter values, media files, conversation notes referencing the person, and import rows containing their data.

**DM-16.** On contact erasure the system must retain, in redacted form: the `suppression_entry` keyed on the phone number; the `audit_log`; `usage_record` rows with the contact reference replaced by a pseudonymous identifier; `message_status_event` counts needed for financial reconciliation; and the **`consent_record` rows**, with the phone number hashed and free-text fields other than the verbatim consent wording removed. The consent record survives because it is the evidence that the messages already sent were lawfully sent — destroying it would leave CITS unable to answer a Meta appeal or a regulator's question about a send that has already happened, and unable to prove the person's own opt-out was honoured. It survives in a form that no longer identifies the person from the record itself.

**DM-17.** The system must replace the contact's phone number on retained rows with a stable one-way hash, so that historical volumes and costs remain correct while the number is no longer recoverable from those tables.

The apparent conflict with a data-protection erasure request is real and must be explained to clients in the words of §20 Compliance: the suppression entry survives because erasing it would cause us to contact the person again, which is the opposite of what they asked for. Retaining a phone number solely to honour a do-not-contact instruction is a narrow, defensible purpose, and the entry stores nothing else about the person. The audit log survives because DPDP Rule 6 requires access logs to be retained for at least a year. The redacted consent record survives for the evidentiary reason in DM-16. All three should be named explicitly in the client-facing privacy notice.

**DM-18.** The system must record every erasure as an `audit_log` entry naming the requester, the contact identifier before redaction (hashed), the tables touched and the completion time.

Routine retention, separate from erasure requests: raw `webhook_event` bodies are prunable after 90 days once processed; `click_event` user agents and IP data after 90 days; media files per the retention schedule in the CO-13 table in §20 Compliance. Meta itself retains message content for at most 30 days, so CITS is the system of record from day one.

### 21.12 Migration order

Create tables in this sequence so that no migration references a table that does not yet exist. Each numbered step can be one migration file.

1. `business_portfolio`
2. `whatsapp_business_account`
3. `client`
4. Better Auth tables (`user`, session, account, organization, member, invitation), then `user_client_role`, then `user_client_permission`
5. `sender_number`, then `access_token`, then `conversational_component`
6. `rate_card`, `rate_card_entry`, `error_code_classification`, `platform_setting` — seed data, no dependencies beyond themselves
7. `workspace_setting`, `contact_type`, `campaign_type`, `opt_out_keyword`, `internal_test_number`, `quiet_hours_window`, `notification_recipient`, `quick_reply`, `click_tracking_config` — the per-workspace configuration family, all depending only on `client` (and `user` for `notification_recipient`)
8. `margin_config`, then `margin_config_entry`
9. `suppression_entry` — no dependencies at all
10. `contact` (depends on `contact_type`)
11. `contact_group`, `saved_segment`, `tag`, then `contact_group_member`, `contact_tag`
12. `consent_record`, `meta_block_entry`
13. `template`, then `template_version`
14. `campaign` (depends on `campaign_type`, `template_version`, `sender_number`), then `campaign_audience_snapshot`, then `campaign_recipient`
15. `conversation`, `customer_service_window`, then `message` (references conversation and campaign_recipient), then `message_status_event`
16. `conversation_note`
17. `frequency_ledger_entry` (references contact and campaign)
18. `import_job`, then `import_error`, then `import_created_contact`
19. `click_link`, then `click_event`
20. `usage_record` (references message, rate_card_entry and margin_config_entry)
21. `audit_log`, `webhook_event`, `notification`
22. Row-level security policies and the append-only triggers, applied last so every table exists
23. Indexes from §21.10

**DM-19.** The system's migrations must be plain, hand-editable SQL files committed to the repository, applied in order, and never edited after being applied to production.

**DM-20.** The migration that enables row-level security must be verified by an automated test that attempts a cross-client read as each of the four workspace roles — Client Admin, Campaign Manager, Inbox Agent and Viewer — and asserts that zero rows are returned. The same test must assert that a Viewer without the `view_full_phone_numbers` permission receives masked numbers from every phone-bearing read path. This test must run in continuous integration and must block deployment on failure.

---

## 22. Screens

### 22.1 Screens

Every screen is scoped to the signed-in user's client workspace unless the role is application-level. Roles referenced here are defined in §6 and are exactly five: **Super Admin** (`super_admin`, held on the user record, not per workspace), and the per-workspace roles **Client Admin** (`client_admin`), **Campaign Manager** (`campaign_manager`), **Inbox Agent** (`inbox_agent`) and **Viewer** (`viewer`). A CITS campaign operator working across several clients is simply a user holding **Campaign Manager** in several workspaces; there is no cross-workspace operator role.

**SR-1.** Every screen carries exactly one of three mobile tiers, defined here once and used consistently in the table below.

- **mobile-critical** — fully operable at 375 px width: every listed primary action can be completed on a phone, with no horizontal scrolling and touch targets of at least 44 px.
- **mobile-usable** — readable and navigable at 375 px, but editing is deferred to a larger screen; edit affordances may be hidden or replaced with a prompt to switch device.
- **desktop-first** — degrades to a legible read-only view plus a "best used on a larger screen" notice below 900 px; never a broken layout.

**SR-1a.** Wherever a screen displays a contact phone number, a Viewer without the distinct **"View full phone numbers"** permission sees the number masked to its last four digits. This applies to contact lists, campaign reports, click reports and the inbox alike.

| # | Screen | Purpose | Key elements | Primary actions | Roles | Mobile tier |
|---|---|---|---|---|---|---|
| SR-2 | Login | Authenticate a user and select a workspace | Email/password, second factor, workspace picker | Sign in, reset password | All | mobile-critical |
| SR-3 | Main dashboard | One glance at what is sending and what is broken | Portfolio-limit utilisation gauge (with the live rolling-365-day template-message count), active campaigns, quality states, last 7 days sent/delivered/read, open alerts, unresolved-send backlog against the 6-hour `unresolved_send_age`, **cost-to-date tile rendered only for roles holding the view-usage-and-cost permission and omitted entirely — never zeroed or greyed — for roles without it** | Drill into any tile | All (scoped) | mobile-critical |
| SR-4 | Clients | Manage the client organisations CITS serves | Table: client, sender number, client status (`onboarding` / `active` / `paused` / `suspended` / `archived`), 30-day volume, cost | Add, change status, impersonate-for-support | Super Admin | desktop-first |
| SR-5 | Client details | Everything about one client in one place | Profile, WABA, assigned numbers, users, consent defaults, rate-card version in force, per-workspace threshold settings, frequency-governor setting, usage summary | Edit, assign number, edit workspace settings | Super Admin, Client Admin (read) | desktop-first |
| SR-6 | Users and roles | Control who can do what | Member list, role (one of the five), invitations, last login, "View full phone numbers" permission toggle | Invite, change role, grant/revoke permission, revoke access | Super Admin, Client Admin | desktop-first |
| SR-7 | WhatsApp sender numbers | Register and configure numbers | Number, WABA, display name and its `name_status`, registration state, data-localisation region, throughput, webhook subscription state, both registration-attempt counters and both deregistration counters against their independent 10-per-72-hour caps | Register, deregister (guarded), set PIN, re-subscribe webhooks | Super Admin | desktop-first |
| SR-8 | Sender-number health | See whether a number can safely send right now | Quality rating (GREEN/YELLOW/RED), connected vs restricted, current throughput, recent failure-code histogram keyed on (api_surface, code), `account_update` enforcement notices with restriction end times, token health-check result (checked every 6 hours) | Pause all sending on this number | Super Admin, Client Admin, Campaign Manager | mobile-critical |
| SR-9 | Contacts | Browse and edit the audience | Search, filters by tag/group/segment/consent state, E.164 number (masked per SR-1a), deliverability state (`unknown` / `deliverable` / `suspect` / `invalid`), last inbound, window state | Add, edit, tag, suppress, reset a `suspect` state | Client Admin, Campaign Manager, Viewer (read) | mobile-usable |
| SR-10 | Contact import | Get a list into the system | File upload, sheet picker, column-to-field mapping, consent-attestation block, validation preview with per-row errors | Upload, map, dry-run, commit | Client Admin, Campaign Manager | desktop-first |
| SR-11 | Import history | Prove what was imported, by whom, under what consent claim | Past imports, row counts, rejects, attestation text captured, downloadable reject file, undo-import eligibility countdown | Download rejects, **undo import** (available for 24 hours; deletes only contacts *created* by that import which have not since been messaged or replied; never reverses an opt-out, never reverts updates to pre-existing contacts, audit-logged) | Client Admin, Campaign Manager | desktop-first |
| SR-12 | Contact groups | Static, explicitly enumerated audience sets | Group list, membership counts, member management | Create, add/remove members, export | Client Admin, Campaign Manager | desktop-first |
| SR-30 | Saved-segment builder | Author a stored filter definition, resolved to contacts at the moment it is used | Filter conditions on tags, consent state, deliverability state, engagement and import source; live "resolves to N contacts right now" preview with an explicit note that the count is evaluated again at send time | Create, edit, duplicate, delete, preview resolution | Client Admin, Campaign Manager | desktop-first |
| SR-13 | Tags | Lightweight labelling | Tag list with usage counts | Create, merge, delete | Client Admin, Campaign Manager | mobile-usable |
| SR-14 | Templates | Inventory of what can be sent, per WABA | Name, language, category, status, quality score, pending `correct_category` flag, WABA ownership, per-WABA-per-language ceiling and name-uniqueness usage | Submit, sync from Meta, archive | Client Admin, Campaign Manager | desktop-first |
| SR-15 | Template composer *(distinct from SR-14)* | Author a template that will pass review | Category chooser with cost delta, component editors within the limits in §11, variable and sample-value editor, live preview, composer validations, projected cost per 1,000 | Save draft, submit, appeal, unpause | Client Admin, Campaign Manager | desktop-first |
| SR-31 | Starter template library | Shorten time-to-first-send with pre-written, CITS-authored templates for society, journal and conference use cases | Browsable catalogue by category and language, preview, notes on why each is likely to pass review | Copy into this client's WABA as a new draft (opens SR-15) | Client Admin, Campaign Manager | desktop-first |
| SR-32 | Conversational components configuration | Configure the WABA-level conversational components on a number | Welcome message on/off and text, ice-breakers, commands list, current synced state from Meta | Edit, sync to Meta, re-read from Meta | Super Admin, Client Admin | desktop-first |
| SR-16 | Campaigns | All campaigns and their state | Table: name, template, audience size, state (one of the eleven), send path, released/held/failed counts | Duplicate, pause, resume, cancel | Client Admin, Campaign Manager, Viewer (read) | mobile-critical (control actions) |
| SR-17 | Create campaign wizard | Build a send safely | This screen implements, step for step, the twelve-step campaign creation and launch flow specified in the campaigns section — beginning with client selection and ending with the pre-flight summary, typed confirmation above the typed-confirmation threshold and approval submission at or above the campaign approval threshold. It is not restated here; the campaigns section is the single normative description | Save draft, schedule, submit for approval, send now | Client Admin, Campaign Manager | desktop-first |
| SR-33 | Campaign approval queue | Decide on campaigns awaiting approval | Campaigns in `pending_approval` with recipient count, template, requested-by and requested-at, pre-flight summary and all exclusion reasons, approval note field | Approve, reject with note (both audit-logged and notified) | Client Admin, Super Admin | mobile-critical |
| SR-34 | Running-campaign monitor *(distinct from SR-16 and SR-18)* | Watch one campaign while it is actually sending | Auto-refreshing every few seconds: released / in-flight / delivered / failed counters, current send rate, **the currently binding throttle named explicitly** (per-number throughput, portfolio daily headroom, portfolio pacing, campaign throttle setting or Meta-side hold), remaining recipients, live error-code stream | Pause, resume, stop, open the failing recipients | Client Admin, Campaign Manager, Viewer (read) | mobile-critical |
| SR-18 | Campaign report | What actually happened, after the fact | Funnel (accepted → sent → delivered → read → clicked), held-for-quality count, failure breakdown by error class, non-delivery rate with its three components itemised separately from the failure rate, per-attempt breakdown by `attempt_key`, per-recipient drill-down, rates outside Meta's 7-day analytics window rendered as "not captured" | Export CSV/XLSX, operator-initiated retry of eligible failures (creates attempt_key+1) | Client Admin, Campaign Manager, Viewer | mobile-critical (summary), desktop-first (drill-down) |
| SR-19 | Inbox | Handle inbound conversations | Conversation list filtered to `open` / `closed`, unread markers, window-expiry countdown, filters by number and assignee | Assign, close, reopen, block user | Inbox Agent, Client Admin, Campaign Manager, **Viewer (read-only: conversation list and threads visible; assignment and block controls hidden)** | mobile-critical |
| SR-20 | Conversation detail | Reply to one person | Thread, contact panel, consent state, phone number masked per SR-1a, composer that hard-switches to template selection when the 24-hour window is closed | Send free-form (window open), send template (window closed), add note, tag | Inbox Agent, Client Admin, Campaign Manager, **Viewer (read-only: composer, assignment and block controls hidden)** | mobile-critical |
| SR-35 | Quick-reply library | Maintain the canned replies agents insert in the inbox | Reply list with shortcode, body, variable placeholders, per-workspace scope, usage count | Create, edit, reorder, delete | Client Admin, Campaign Manager | mobile-usable |
| SR-21 | Opt-outs | Client-scoped record of who opted out and why | Number, source (STOP-style reply, button tap, `user_preferences` stop, error 131050, off-platform request), timestamp, actor | Add manual opt-out, export | Client Admin, Campaign Manager | mobile-usable |
| SR-36 | Opt-out review queue | Decide on inbound messages that look like opt-out intent but are not certain | Pending items with the inbound text, the contact, detection reason and confidence, ageing indicator; items resolve to opted-out or dismissed | Confirm opt-out, dismiss, open conversation | Client Admin, Campaign Manager, Inbox Agent | mobile-critical |
| SR-22 | Suppression list *(distinct from SR-21)* | The global, cross-client block on sending | Number, reason, first added, whether Meta-side blocklist is also set | Add, remove with reason and audit entry | Super Admin only | desktop-first |
| SR-23 | Usage report | Who consumed what, and what it cost | Per client per month: delivered counts by category, rate-card version applied, computed cost, GST line shown separately | Export, change month | Super Admin, Client Admin (own client) | desktop-first |
| SR-24 | Audit logs | Answer "who did that" | Filterable event stream: actor, action, entity, before/after, IP; includes approval requests and decisions, undo-import events and deliverability-state reversals | Filter, export | Super Admin | desktop-first |
| SR-25 | Webhook/event logs | Debug the Meta integration | Raw payloads, signature-verification result, processing state, replay from stored raw | Re-process a stored event | Super Admin | desktop-first |
| SR-26 | Notifications centre | One place for alerts that need a human | Quality transitions, template paused/disabled, enforcement notices, payment-method failures (131042), token expiry, unresolved-send backlog beyond `unresolved_send_age`, approval requests and decisions | Acknowledge, mute, open source object | Super Admin, Client Admin, Campaign Manager | mobile-critical |
| SR-27 | System health | Is the platform itself working | Queue depths, worker liveness, webhook lag, Meta API error rates, last successful analytics poll | Retry a stuck queue | Super Admin only | desktop-first |
| SR-28 | Settings | Account, workspace and platform configuration | Profile; workspace defaults; typed-confirmation threshold (default 500) and campaign approval threshold (default 1,000), the latter refused if set below the former; CITS frequency-governor ceiling (suggested default 4 marketing messages per contact per 30 days per client); throttle policy; rate-card versions; API version in use | Edit | Super Admin, Client Admin (subset) | desktop-first |

**SR-29.** The system must never expose SR-22 (suppression list) or SR-27 (system health) to a Client Admin, Campaign Manager, Inbox Agent or Viewer, because both are cross-client.

**SR-37.** Inbox Agents have no report access at all: SR-18, SR-23 and SR-34 must not be reachable by a user whose only role is Inbox Agent.

## 23. MVP scope

### 23.1 In scope, as requested

**MV-1.** Login and session management; client workspace management; sender-number setup and registration; contact upload; contact groups; tags; template storage and submission; campaign creation; bulk sending with batch control; webhook receiving; shared inbox; manual replies; message status tracking; opt-out detection; campaign reports; report export; a basic dashboard.

### 23.2 In scope because the research says they are not optional

| # | Addition | Why it cannot wait |
|---|---|---|
| MV-2 | Global suppression list, cross-client, keyed on phone number | One person's opt-out must hold across every client sharing the portfolio; a per-campaign list leaks. |
| MV-3 | Customer-service-window tracker plus composer enforcement | Outside the 24-hour window only templates can be sent; without enforcement every reply fails with 131047 on `/messages`. |
| MV-4 | Error classification table stored as data, keyed on (api_surface, code) | Retry semantics differ per code, and Meta reuses the same code with different meanings across endpoints — 131047, 130429 and 131021 all mean different things on `/messages` and `/block_users`. A deploy must not be required to fix a retry loop. |
| MV-5 | Idempotent sending (own send id, unique outbox constraint on (campaign_id, recipient_id, template_version_id, attempt_key), `biz_opaque_callback_data`, wamid persisted before "sent") | Meta publishes no idempotency key; a timeout without this pattern double-charges the client. |
| MV-6 | Raw webhook persistence with signature verification and dedupe on (wamid, status) alone | There is no replay API and no dead-letter queue at Meta; if the payload is lost it is gone. Keying dedupe on the pair alone means a redelivery carrying a different provider timestamp is still absorbed as a conflict. |
| MV-7 | Portfolio-level messaging-limit tracking | Since 2025-10-07 the daily unique-recipient cap is pooled across the whole CITS portfolio — every client shares one cap and one blast radius, so the scheduler's outer bound is a portfolio number, not a per-number one. |
| MV-8 | A `send_path` field on campaigns (`cloud_api` / `marketing_messages`) | Max-price bidding requires the Marketing Messages endpoint; adding the discriminator later is a data migration across live campaigns. |
| MV-9 | Analytics warehousing on a schedule | Read and click data from `template_analytics` are available only up to 7 days from send; unwarehoused, they are lost permanently, and any rate whose numerator was never captured must render as "not captured" rather than zero. |
| MV-10 | Rate cards as versioned data keyed by effective date | Meta changes rates quarterly and publishes India numerals only in a downloadable rate card; hardcoding produces wrong invoices later. **[Verify before build]** — the India INR numerals in §17 are secondary transcription and must be read off the rate-card CSV. |
| MV-14 | Campaign approval workflow | A campaign at or above the campaign approval threshold (default 1,000 recipients) enters `pending_approval` on submit and can reach `scheduled` or `running` only on approval by a Client Admin or Super Admin. The record carries approval-requested-by, approval-requested-at, approved-by, approved-at and approval-note; requests and decisions raise notifications and are audit-logged. This is CITS product policy, not a Meta rule, and retrofitting an approval gate onto a live campaign state machine is a migration. |
| MV-15 | Saved segments as a first-class entity, separate from contact groups | A contact group is static, explicit membership; a saved segment is a stored filter definition resolved to contacts at the moment it is used. Nothing in v1 has "dynamic groups". Both the screens and the data model must reflect the split from day one, because collapsing them later silently changes who a campaign reaches. |
| MV-16 | CITS-side frequency governor | Independent of Meta's per-user cap: a configurable per-contact ceiling on marketing messages per rolling period, settable per client and platform-wide (CITS product policy; suggested default 4 per 30 days per client). Enforced in the pre-send suppression check and surfaced in the pre-flight summary as its own exclusion reason, never folded into the failure rate. |
| MV-17 | Viewer phone masking | "View full phone numbers" is a distinct permission. Viewers see numbers masked to the last four digits across contact lists, campaign reports, click reports and the inbox unless granted it. Masking that is bolted on after export paths exist always leaks somewhere. |

### 23.3 Out of scope for v1

**MV-11.** Deferred at the client's request: SaaS billing and invoicing, AI chatbot, complex CRM integrations, drag-and-drop automation builders.

**MV-12.** Deferred on the research: WhatsApp Flows (they require a live encrypted endpoint with a key pair per WABA); the Calling API; the Marketing Messages send path (abstracted per MV-8 but not implemented, and it needs a separate per-WABA Terms acceptance in Business Manager); coexistence with the WhatsApp Business app (it caps throughput at a fixed 20 messages per second and disables features); max-price bidding; multi-channel (SMS, Instagram, RCS); and the Official Business Account green tick, which is not required to send.

**MV-18.** Deferred by explicit decision in this document, and carried into the roadmap in §24: the CITS-hosted public opt-in form (`website_form` remains a valid `source_type` on a consent record, meaning consent was collected on the client's *own* website and imported with the contact — CITS hosts no public form in v1); per-agent conversation and response-time metrics; email delivery of notifications (v1 notifications are in-product only); a dedicated authentication-template composer; and the children's-data workstream.

### 23.4 Acceptance criteria for calling v1 done

**MV-13.** The system must satisfy all of the following before go-live is declared:

1. A user can log in, and a user of client A cannot read, list or address any record belonging to client B — proven by an automated cross-tenant isolation test suite that fails the build if a scoped query is bypassed.
2. A sender number is registered, its display name shows `APPROVED`, and webhooks are subscribed and verified by signature on every request.
3. A spreadsheet of **20,000 rows — the documented import cap — imports end to end at the cap**, with phone numbers normalised to E.164, invalid rows rejected to a downloadable file, a consent attestation captured, and a row count one above the cap refused with a clear message rather than truncated.
4. Undo import, run within 24 hours of that import, removes only the contacts it created that have not been messaged or replied, leaves pre-existing contacts and every opt-out untouched, and writes an audit entry.
5. A template is authored, submitted, approved, and its status and quality changes arrive by webhook and are visible in the UI without a manual refresh cycle longer than one minute; the sending engine refuses to release a message whose template is not `APPROVED` for the exact language being sent.
6. A campaign of more than 500 recipients requires the campaign name to be typed; a campaign of 1,000 or more additionally enters `pending_approval` and cannot launch until a Client Admin or Super Admin approves it.
7. A campaign sends, is paused mid-flight, resumed, and completes — with suppressed, frequency-governed and Meta-frequency-capped recipients excluded and reported separately from failures, and the running-campaign monitor naming the binding throttle throughout.
8. A campaign whose recipient count exceeds remaining portfolio daily headroom is **blocked** from launching, is told how many recipients cannot be reached today, and is offered splitting across days.
9. A campaign against a client in `suspended` status stays `scheduled` and is refused at pre-flight, with the reason shown.
10. Restarting the sending worker mid-campaign produces zero duplicate messages, and an operator-initiated retry creates rows under attempt_key+1 that appear in the same campaign report as a separate attempt.
11. Every status webhook is persisted raw, dedupe on (wamid, status) absorbs a redelivery carrying a different provider timestamp, and the derived current status never regresses from read to delivered.
12. An inbound message opens a conversation, an Inbox Agent replies inside the window, and after the window closes the composer refuses free-form text and offers templates instead; a Viewer can read the same conversation with the composer, assignment and block controls absent and the number masked.
13. A campaign report and a usage report both export; the usage report attributes cost per client with the rate-card version and GST shown as separate lines; the campaign report shows failure rate and non-delivery rate as distinct figures with the three non-delivery components itemised; and a metric outside Meta's 7-day analytics window renders as "not captured".
14. The cost tile is absent — not zeroed — for a signed-in role without the view-usage-and-cost permission.
15. A real campaign is sent to a real scientific society client, from that society's own display name, and its report is reviewed with the client.

## 24. Roadmap

### 24.1 Sequencing

**RM-1.** Sequenced by theme, not by date, except where marked **dated**. Dated items carry an external deadline and cannot be reordered behind undated work.

| Order | Theme | Rationale |
|---|---|---|
| 1 | **Migrate marketing sends to the Marketing Messages API** | **Dated commitment.** Max-price bidding becomes required in eligible geographies in Q2 2027 and cannot be done on the Cloud API send endpoint. Each client WABA also needs its own Terms acceptance, so this is per-client lead time, not one switch. |
| 2 | **Data-protection compliance** | **Dated commitment.** India's DPDP Rules become fully operational in May 2027 — notice, security safeguards, access logs retained at least a year, breach reporting with no materiality threshold, erasure, and a published grievance procedure. **[Verify before build]** exact commencement wording differs across law-firm summaries; confirm against the notified gazette text. |
| 3 | **Children's-data workstream** | Feeds item 2 but is a distinct build: age assurance, verifiable parental consent, and the resulting restrictions on processing. Deferred from v1 because CITS's year-one audience is society members and conference delegates; it becomes unavoidable the moment a client's audience includes minors. |
| 4 | Email delivery of notifications | v1 raises every alert in-product only (SR-26). Email delivery is the first thing asked for once a Super Admin stops watching the dashboard continuously, and it requires a transactional mail provider, per-user preferences and a digest policy. |
| 5 | Template approval assistance | Cheapest quality win: fewer rejections directly reduces campaign lead time. |
| 6 | Dedicated authentication-template composer | Authentication templates have their own component rules, code-delivery options and per-message pricing. v1 stores and sends them but does not offer a purpose-built authoring flow. |
| 7 | Hosted public opt-in form | CITS hosts no public form in v1. This delivers a CITS-hosted, per-client opt-in page writing consent records directly, replacing the current import-with-attestation path for web-collected consent. |
| 8 | SaaS billing and client self-onboarding | Turns the usage and cost attribution already built in v1 into revenue; self-onboarding only makes sense once billing exists. |
| 9 | Drip campaigns | Natural extension of the campaign engine; no new Meta surface required. |
| 10 | Per-agent conversation and response-time metrics | Explicitly not in v1: Inbox Agents get no report access at all. Worth building once inbox volume makes agent-level comparison meaningful, and it needs a policy decision about who may see an individual's numbers. |
| 11 | CRM and Google Sheets integration | Removes the manual re-import loop that dominates day-to-day client effort. |
| 12 | Integration with CITS's own journal, society and conference systems | The real differentiator — submission received, review assigned, registration confirmed are utility-category events CITS already owns. |
| 13 | Payment reminder automation | Depends on 12; high perceived value for societies chasing membership renewals. |
| 14 | WhatsApp Flows | Requires a live encrypted endpoint with a key pair per WABA, plus key rotation and health checks — a standing operational commitment, not a feature toggle. |
| 15 | Calling API | New surface, new permissions, new webhooks; no v1 use case demands it. |
| 16 | AI reply suggestions, then chatbot | Suggestions first (human in the loop, low risk); autonomous replies only after the inbox has volume worth automating. |
| 17 | Coexistence with the WhatsApp Business app | Attractive for clients who still run a phone-based workflow, but it caps throughput at a fixed 20 messages per second and disables features, so it must never be enabled on a number carrying campaign volume. |
| 18 | Official Business Account green tick | Not required to send. Pure brand value; pursue once a client asks and the account has the history to support an application. |
| 19 | Multi-channel (SMS, Instagram, RCS) | Each is a separate provider relationship and a separate consent model; only sensible once the WhatsApp product is stable and the contact and consent models have proven they generalise. |
| 20 | White-label client portal | Only worth building once self-onboarding and billing exist. |
| 21 | Advanced analytics | Warehoused data accumulates from v1, so value compounds with time rather than with build order. |

## 25. Development phases

### 25.1 Phases

**PH-1.** Sizing below is **relative effort**, not calendar time. One solo developer with an AI coding assistant; no team is assumed anywhere.

| Phase | Goal | What gets built | Exit criteria | Risk retired | Effort |
|---|---|---|---|---|---|
| **0. Meta groundwork and spikes** *(runs in parallel with everything)* | Prove the platform works before writing a product on top of it | Create the WABA inside the existing verified portfolio; add and register the first number with a 6-digit PIN and India data-localisation region; get the display name approved; create a business system user token; subscribe webhooks; send one real message by hand. Plus the three technical spikes named in §3: BullMQ on Bun, Valkey version and Lua compatibility, and Sentry under Bun | A message sent from a throwaway script and its status webhook received on a real HTTPS server, signature verified. Each spike has a written go/no-go | Everything downstream is worthless if the account cannot send | S |
| **1. Foundations** | A skeleton that is safe to build on | Auth, workspaces, the five roles, the "View full phone numbers" permission, clients, users, audit log, and the cross-tenant isolation test suite | A second workspace cannot see the first one's data, proven by tests that run in CI; a Viewer without the permission sees masked numbers on every path including export | Retrofitting tenancy or masking is the most expensive possible rework | M |
| **2. Contacts and consent** | A trustworthy audience | Contact CRUD, import pipeline in a queued worker, undo import, contact groups, saved segments, tags, consent records with provenance, deliverability states, global suppression list | A **20,000-row** import completes at the cap with rejects downloadable; undo import within 24 hours removes only untouched newly created contacts; a suppressed number cannot be selected into a send by any query path, including through a saved segment | Sending to people who did not consent is the fastest route to enforcement | M |
| **3. WhatsApp integration** | Real messages in and out | Sender numbers with both independent attempt counters, encrypted token storage and 6-hourly health checks, webhook receiver with signature verification and raw persistence, message and status-event model with (wamid, status) dedupe and monotonic status ranking, inbox with window enforcement, quick-reply library | Inbound message appears in the inbox within seconds; reply sends; composer blocks free-form after the window closes; a redelivered status with a changed timestamp is absorbed as a conflict | The integration's hardest correctness problems (dedupe, ordering, window) surface here, not during a campaign | L |
| **4. Templates** | Content that Meta will accept | Template list scoped to the WABA, composer with validations, starter library, conversational components configuration, submission and sync, status and quality webhooks, pause/appeal handling | A template authored in the UI is approved by Meta and its status change lands automatically; the sending engine refuses a non-`APPROVED` language variant | Approval takes up to 24 hours, so it must be de-risked before campaigns | M |
| **5. Campaigns and sending engine** | Controlled bulk sending | Wizard, audience resolution with suppression, frequency-governor and Meta-cap exclusion, approval workflow and approval queue, idempotent outbox keyed on template_version_id and attempt_key, layered throttles, portfolio headroom block, portfolio pacing arithmetic against live rolling-365-day volume, circuit breakers, pause/resume/cancel, running-campaign monitor, held-for-quality handling | A campaign above the approval threshold cannot launch unapproved; a campaign completes; a worker restart produces no duplicates; a simulated template pause halts the remainder; a headroom overrun is blocked with a split-across-days offer | The commercially riskiest code path in the product | L |
| **6. Reporting, usage and cost** | Trustworthy numbers | Campaign reports, dashboard with permission-gated cost tile, exports, per-client usage and cost with versioned rate cards, scheduled analytics warehousing | Numbers on the dashboard reconcile against status events; failure rate and non-delivery rate are distinct and the latter is itemised; a warehousing job has run for seven consecutive days; an uncaptured rate shows "not captured" | Read and click data expire in 7 days at Meta; late is the same as never | M |
| **7. Click tracking, hardening, go-live** | Ship it | Short-link domain and redirect handler, notifications centre, opt-out review queue, system health, security hardening, the 72-hour-plus Bun soak test under representative load | Soak test shows no unbounded memory growth; MV-13 checklist fully passes | Long-running process behaviour under Bun is the least-proven stack assumption | M |

**PH-2. Overlap.** Phase 0 runs alongside all others — display-name approval and template review are Meta-side waits, not developer work. Phase 4 (templates) can overlap Phase 3 once the token and API client exist. Phase 6 can start as soon as Phase 3's status events land, because reporting reads them rather than the campaign engine. Phases 1, 2, 5 and 7 are strictly sequential.

**PH-3. The single most likely thing to go wrong per phase.**

| Phase | Most likely failure |
|---|---|
| 0 | A retry loop consumes the registration counter and locks the number (error 133016). Registration and deregistration are two independent counters, each capped at 10 per number per rolling 72 hours, and a data-localization-region change consumes one from each. Guard both behind the eighth-attempt typed confirmation and the unconditional eleventh-attempt refusal from the first commit. |
| 1 | Tenant scoping is enforced in application code only and one query forgets it. Enforce in the database. Phone masking has the same failure mode on export paths. |
| 2 | Phone numbers imported without a leading plus are silently prefixed with the sender's country code and delivered to the wrong person. Normalise to E.164 at ingest and reject anything that does not validate — that syntactic rejection is the only thing that may set deliverability state `invalid`. |
| 3 | Webhook duplicates or out-of-order arrivals corrupt message state. Dedupe on (wamid, status) only, store the provider timestamp without keying on it, order by the payload timestamp, never by arrival. |
| 4 | Templates are submitted as Utility, approved as Marketing, and the cost model silently multiplies. Show the category actually approved, not the one requested. |
| 5 | The campaign appears to stall because Meta's pacing is holding messages, and the operator retries. The running-campaign monitor must name the binding throttle — "batch 1 released, remainder pending Meta quality assessment" — and the system must never auto-retry a held, frequency-governed or frequency-capped send. Related: assuming the portfolio has exited pacing. At just under 50,000 template messages a month the portfolio sits below the 500,000-per-rolling-365-days line for roughly the first ten months, so pacing is the default state in year one and the rolling count must be read as live data. |
| 6 | Analytics polling misses its window and read rates are lost for good. Alert on a missed poll, not just a failed one, and render the gap as "not captured" rather than zero. |
| 7 | Memory grows over days of continuous sending and is only noticed in production. That is exactly what the soak test exists to catch — do not skip it under schedule pressure. |

---

## Appendix A — WhatsApp error codes and how to handle them

Three rules govern everything below.

**APP-1.** The system must branch on the JSON `code` field inside the error body, never on the HTTP status code. Meta does not populate HTTP status meaningfully for most WhatsApp errors — a call can return HTTP 200 and still have failed, and many genuine failures arrive later on the statuses webhook rather than in the API response at all.

**APP-2.** The system must store this table as rows in the database (api_surface, code, plain-English meaning, class, action, retry policy), not as a `switch` statement in code. Meta adds and re-classifies codes; an operator must be able to change a row's class and retry policy through an admin screen without a deploy. Unknown codes must default to a safe class (bounded retry, then terminal with an operational alert) and must be logged so the table can be extended.

**APP-3.** The classification table is keyed on **(api_surface, code)** — never on the code alone. Meta reuses the same numeric code across endpoints with entirely different meanings, and a code-only lookup will mis-handle at least these three collisions:

- **131047** — "customer service window expired" on `/messages`, but "target has not messaged in 24 hours" on `/block_users`.
- **130429** — throughput ceiling on `/messages`, but request rate limit on `/block_users`.
- **131021** — sender equals recipient on `/messages`, but self-block on `/block_users`.

Every row below therefore carries its API surface. `*` means the row applies on any surface until a surface-specific row is added.

**Classes — exactly five.** **`RETRY_BACKOFF`** (transient; retry with exponential backoff and jitter) · **`TERMINAL`** (do not retry this send) · **`CONDITIONAL`** (retry only once a stated external condition clears — an enforcement window, a throttle period, a fixed operator action) · **`PROBABLE_INVALID_CONTACT`** (evidence against the contact, not proof) · **`OPERATIONAL_ALERT`** (a human must act; sending is or will be blocked). No other class values exist anywhere in the product.

| API surface | Code | Meaning in plain English | Class | Required action |
|---|---|---|---|---|
| `*` | 4 | App-level rate limit hit | `RETRY_BACKOFF` | Exponential backoff with jitter |
| `*` | 80007 | WABA-level rate limit hit | `RETRY_BACKOFF` | Backoff |
| `/messages` | 130429 | Cloud API throughput ceiling reached | `RETRY_BACKOFF` | Reduce send rate; see §13 |
| `/block_users` | 130429 | Graph API request rate limit on the block-users endpoint | `RETRY_BACKOFF` | Backoff the block/unblock worker only — do not throttle sending |
| `/messages` | 131056 | Pair rate limit — too many messages to the same person too fast | `RETRY_BACKOFF` | **Per-recipient** backoff (Meta suggests 4^X seconds) |
| `*` | 131057 | Number in maintenance, or mid throughput upgrade | `RETRY_BACKOFF` | Retry after ~1 minute |
| `*` | 2 / 131016 / 133004 | Temporary service unavailability at Meta | `RETRY_BACKOFF` | Backoff |
| `/messages` | 131000 | Unknown send error | `RETRY_BACKOFF` | Bounded retries, then terminal |
| `/messages` | 131047 | The 24-hour customer service window has expired | `CONDITIONAL` | Do not retry until the window reopens. In the inbox, offer an approved template instead |
| `/block_users` | 131047 | Target has not messaged this number in the last 24 hours, so it cannot be blocked | `TERMINAL` | Do not retry. Suppress locally instead of blocking at Meta |
| `/messages` | 131049 | Meta's per-user marketing frequency cap blocked this message | `CONDITIONAL` | Never blind-retry; never retry within 24 hours; retrying can suspend delivery to that user for a further 24 hours. Report as "blocked by frequency cap" — a non-delivery component, never a failure |
| `/messages` | 131050 | User opted out of marketing from this business | `TERMINAL` | Write to suppression list |
| `/messages` | 131048 | Spam rate limit — earlier messages were blocked or flagged | `TERMINAL` | Operational alert; pause the campaign |
| `/messages` | 131021 | Sender and recipient are the same number | `TERMINAL` | Validation bug — fix |
| `/block_users` | 131021 | Attempt to block the sender's own number (self-block) | `TERMINAL` | Validation bug — filter the business's own numbers out of block requests |
| `/messages` | 131051 | Unsupported message type | `TERMINAL` | Fix payload |
| `/messages` | 131403 | The business has blocked this user | `TERMINAL` | Suppress |
| `/messages` | 131026 | "Message undeliverable" | `PROBABLE_INVALID_CONTACT` | Record a strike; never invalidate on one hit (see below) |
| `/messages` | 132015 | Template paused for low quality; also the drop code for template-pacing kills | `TERMINAL` | Edit the template; do not retry |
| `/messages` | 135000 | Business portfolio pacing dropped the remaining queue | `TERMINAL` | Surface to the user; the rest of the campaign did not send |
| `/messages` | 132000 | Wrong number of template parameters | `TERMINAL` | Fix the template call |
| `/messages` | 132001 | Template not approved, or wrong language | `TERMINAL` | Fix. The sending engine must not have released this message at all — see the template status gate in §11 |
| `/messages` | 132005 | Translated text too long | `TERMINAL` | Fix |
| `/messages` | 132007 | Policy violation in the template | `TERMINAL` | Rewrite and resubmit |
| `/messages` | 132012 / 132018 | Parameter format or validation error | `TERMINAL` | Fix |
| `/messages` | 132016 | Template permanently disabled | `TERMINAL` | Create a new template |
| `/messages` | 131064 | Template-classification enforcement limit | `CONDITIONAL` | Wait out the enforcement window, then resume |
| `/messages` | 132068 / 132069 | Flow blocked / Flow throttled (10+ messages in an hour) | `CONDITIONAL` | Fix the Flow / back off until the throttle window clears |
| `*` | 131042 | Payment method problem | `OPERATIONAL_ALERT` | Blocks **all** sending. Page a human; do not retry |
| `*` | 131045 / 133010 | Number not registered | `OPERATIONAL_ALERT` | Re-register (carefully — see 133016) |
| `*` | 368 / 130497 / 131031 | Account restricted / country restriction / account lock | `OPERATIONAL_ALERT` | Stop all sending, notify, appeal |
| `*` | 190 / 0 / 200 | Token expired or authentication failure | `OPERATIONAL_ALERT` | Re-authenticate. The 6-hourly token health check should normally catch this first |
| `*` | 131037 | Display name not approved | `OPERATIONAL_ALERT` | Fix in WhatsApp Manager |
| `/messages` | 131053 | Media upload failure | `TERMINAL` | Fix the asset |
| `/register` | 133005 / 133008 / 133009 | Two-step PIN wrong / locked out / entered too fast | `OPERATIONAL_ALERT` | 133008 and 133009 carry a retry-after value — honour it |
| `/register` | 133015 | Number was recently deleted | `RETRY_BACKOFF` | Wait 5 minutes |
| `/register`, `/deregister` | 133016 | Registration or deregistration attempt limit reached | `OPERATIONAL_ALERT` | The number is locked for 72 hours (see below) |
| `*` | 2388012 / 2388091 / 2388093 / 2388103 | Migration errors | `OPERATIONAL_ALERT` | Manual intervention |

**The three most commonly mishandled codes.**

**131026** is overloaded. It fires for a genuinely unreachable number, but also for an out-of-date WhatsApp client, a user who has not accepted WhatsApp's terms, and for Meta declining the message on policy or quality grounds. A contact is never set to `invalid` on delivery evidence — `invalid` is reserved for syntactic validation failure. Delivery evidence can only move a contact to `suspect`, and only after **N** occurrences of 131026 across at least **M** distinct campaigns and at least **D** distinct calendar days (defaults N=3, M=2, D=2). The move is operator-reversible. This is CITS product policy, not a Meta rule.

**131049** means Meta's per-user marketing frequency cap blocked delivery. Meta publishes no number for this cap and describes it as dynamic per individual. Retrying makes it worse — Meta's documentation warns that excessive retries may make further delivery to that user unavailable for up to 24 hours. Treat it as its own campaign metric ("blocked by frequency cap"), count it inside the **non-delivery rate** and never inside the **failure rate**, and never retry the same recipient within 24 hours. This is separate from CITS's own frequency governor, which suppresses before the send is ever attempted.

**133016** locks a phone number for **72 hours**. Registration and deregistration are **two independent counters**, each capped at 10 requests per number per rolling 72-hour window; a data-localization-region change consumes one from each. A naive retry loop in onboarding takes a client's number offline for three days with no override, and by the time Meta returns 133016 the lockout has already happened — so the guard must sit in front of Meta, not behind it. The registration path must therefore hold its own counters in our database, one per operation, and:

- **refuse the eighth attempt** in either counter unless an operator types an explicit confirmation, and
- **refuse the eleventh attempt** in either counter unconditionally, with no override.

## Appendix B — Meta onboarding checklist

Assumes CITS's business portfolio already exists and business verification is already approved. Do these in order; each step's trap is stated with it.

1. **Create the WhatsApp Business Account (WABA)** inside the CITS portfolio, in WhatsApp Manager. *Trap:* a WABA belongs to exactly one portfolio forever and can never be migrated. Everything created here stays CITS's (see §2 and §5). Templates live on the WABA, not on the sender number, and are usable by any sender number attached to that WABA.
2. **Add the business phone number** for this client. *Trap:* the number must **not** be active on consumer WhatsApp or the WhatsApp Business app. Meta will not register a number already in use; it must be deleted from WhatsApp first, which takes effect for that user immediately and irreversibly. Use a fresh number CITS controls. *Trap:* a new portfolio is capped at **2 phone numbers**, rising to 20 after business verification — confirm the cap in WhatsApp Manager before promising a client a number.
3. **Submit the display name** — the client's organisation name, since the number carries the client's brand. Approval is reviewed by Meta. *Trap:* where a name represents a business other than the account owner, Meta expects the relationship to be evident on both parties' websites. **[Verify before build]** This wording comes from a BSP, not Meta directly — confirm against Meta's own display-name help article before onboarding the first client. Sending is blocked with error 131037 until the name is approved.
4. **Register the number** via `POST /<PHONE_NUMBER_ID>/register` with a 6-digit `pin` and `data_localization_region: "IN"`. *Traps:* (a) the PIN is required unconditionally and, if two-step verification is not already on, **the value you supply becomes the number's two-step verification PIN** — store it in the secret store immediately, because you will need it again; (b) changing the data localization region later requires deregister plus re-register, which consumes one attempt from **each** of the two counters; set `IN` now; (c) registration and deregistration are **two independent counters, each capped at 10 attempts per number per rolling 72 hours** — not one shared pool of 10. Exceeding either returns error 133016 and locks the number for 3 days. Our own guard refuses the eighth attempt in a counter without typed operator confirmation and the eleventh unconditionally (see Appendix A).
5. **Create a system user** in Business Settings. Prefer an **employee** system user granted access to specific WABAs (least privilege) over an admin system user, which gets everything in the portfolio by default.
6. **Generate a system user token** with `whatsapp_business_messaging` (sending and the `messages` webhook) and `whatsapp_business_management` (templates, phone numbers, and all other webhook fields). Store it encrypted; never in client-side code. Register it with the token health check, which runs **every 6 hours**. *Note:* because CITS owns the assets, this token is sufficient — no App Review, no Embedded Signup, no Tech Provider onboarding (see §2).
7. **Configure the webhook endpoint.** Provide an HTTPS callback URL and a verify token you generate. Meta calls the URL with `hub.mode`, `hub.challenge` and `hub.verify_token`; the endpoint must compare the token and echo the challenge verbatim as plain text. *Trap:* the handshake fails silently if the endpoint returns JSON or a redirect.
8. **Subscribe the app to the WABA** (`POST /<WABA_ID>/subscribed_apps`), then subscribe to each field:

| Field | What it delivers |
|---|---|
| `messages` | Inbound messages **and** all outbound delivery statuses — the core feed |
| `account_update` | Account-level changes, restrictions and policy enforcement notices |
| `phone_number_quality_update` | Quality rating changes and throughput upgrade events |
| `message_template_status_update` | Template approved, rejected, paused, disabled |
| `message_template_quality_update` | A template's quality score moved |
| `template_category_update` | Meta re-categorised a template (e.g. utility → marketing) |
| `business_capability_update` | Messaging limit tier changes |
| `account_alerts` | Operational alerts against the account |
| `user_preferences` | A user stopped or resumed marketing natively in WhatsApp |

9. **Add a payment method** to the WABA in WhatsApp Manager. *Trap:* without it, sends fail with 131042, which blocks everything. Set the currency to INR — India-eligible WABAs must be on INR by 2026-12-31, and Meta stops delivering from non-INR WABAs from 2027-01-01.
10. **Send a first test message** to a phone that has messaged the number (so the service window is open), confirm HTTP 200 and a wamid, then confirm the `sent` and `delivered` webhooks arrive and are persisted against the dedupe key **(wamid, status)**. Onboarding is not complete until the webhook round-trip is proven, not just the API call.

## Appendix C — Verify before build

### Blocking commercial items

| # | Question to answer | Where | What breaks if wrong |
|---|---|---|---|
| C1 | **Every INR rate in this document** (₹0.8631 marketing, ₹0.115 utility, ₹0.115 authentication) is secondary transcription. Download Meta's own INR rate card CSV and INR volume-tier CSV. **This is the leading blocking item — nothing else in this appendix outranks it.** | Business Manager, authenticated — Meta no longer renders India numerals inline | Every cost figure, every internal margin estimate, and any number quoted to a client is wrong. **No rupee figure may be shown to a client until this is done.** |
| C2 | Did India rates change on 2026-07-01? Current cards are "effective July 1, 2026" but India is absent from the change list. | Same CSV, not the change-list page | Cost tracking is silently off from day one |
| C3 | India volume-tier thresholds and discounts (the "25k / 100k / 250k, up to −30%" ladder) | Meta's INR volume-tier CSV | Only affects utility and authentication, and only above 25k/month — not a year-one risk, but do not quote the ladder |
| C4 | Exact rates for **paid service messages and in-window utility messages from 2026-10-01**. Meta publishes by 2026-09-01. | Meta pricing updates page | The single biggest cost lever in this product (free in-window utility) disappears. Every cost model needs a pre- and post-October case |
| C5 | 18% GST on Meta's charges (imported digital services), plus input-credit treatment | CITS's accountant | Landed cost per message understated by 18% |

### Structural and API items

| # | Question | Where | What breaks |
|---|---|---|---|
| C6 | **Meta's WhatsApp changelog could not be retrieved during research** — every fetch returned an error. Any very recent breaking change is not captured in this document. | Meta's WhatsApp Business Platform changelog | Unknown. **Re-check before the build starts**, and again before launch |
| C7 | Latest Graph API version. v25.0 is current as of 2026-07-21, but v26.0 is due on the ~4-month cadence | Graph API changelog | Integration built against a version already announcing deprecations |
| C8 | Exact pair rate limit (the "1 message per 6 seconds to the same user" figure) and the Graph API call-rate formula | Meta's rate-limits page, which could not be fetched | 131056 and 80007 error storms under load. Add a research spike before load testing |
| C9 | Interactive message limits (3 reply buttons, 10 list rows) — from a search snippet, not a fetched Meta page | Meta interactive-message docs | Composer validation rejects valid messages or accepts invalid ones |
| C10 | Button label limit: Meta's table says 25 characters, several BSPs say 20 | Meta template components page | Build to 20; low risk |
| C11 | Whether `data_localization_region` can be set on an already-registered number, or requires deregister + re-register | Registration docs / Meta support | If re-registration is required, the change consumes one attempt from **each** of the two 10-per-72-hours counters |
| C12 | Whether the October-2025 portfolio-level messaging-limit change is fully rolled out | WhatsApp Manager, observed behaviour | Our shared-limit assumption (§2, §5) is the basis of the whole capacity model |
| C13 | BullMQ on Bun: is the Bun Redis adapter production-grade? Also BullMQ's minimum Valkey version and Lua compatibility | Time-boxed spike before architecture freeze | Fall back to pg-boss (documented in §3) |
| C14 | exceljs maintenance activity; Auth.js/Better Auth status | GitHub | Dependency risk only |
| C22 | **The full country list accepted by `data_localization_region`.** Only `IN` and `BR` are confirmed from fetched sources; the rest of the list, and whether any of CITS's future markets are absent from it, is unverified. **[Verify before build]** | Meta registration / local storage docs, in a browser | A client in an unsupported region cannot be given in-region storage, and any commitment made to them on data residency is unsupportable |
| C23 | **Graph API request-rate figures** — the per-app and per-WABA request-per-hour formulas, and the separate request-rate ceiling that returns 130429 on `/block_users` rather than on `/messages`. Every figure currently in this document is inferred, not fetched. **[Verify before build]** | Meta's Graph API rate-limits and WhatsApp rate-limits pages | Block/unblock and template-management workers are sized wrongly, producing 130429 storms on a surface where the code does **not** mean a sending throughput problem |

### Policy and legal items

| # | Question | Where | What breaks |
|---|---|---|---|
| C15 | Meta's policy page carries **no version or effective date**. Never cite one. | whatsappbusiness.com/policy | A dated citation in a client contract is unsupportable |
| C16 | Display-name policy for representing another business (step B3 above) | Meta help article, in a browser | Display names rejected at scale; the whole one-number-per-client model depends on this |
| C17 | A marketing opt-out button is **not** documented by Meta as mandatory, and `MARKETING_OPT_OUT` does not exist in the button enum | Meta template components docs | Do not tell clients Meta requires it. We add it ourselves as a quick reply (see §10) |
| C18 | The URL-shortener prohibition is not on any currently-live Meta page; enforcement runs through SCAM/ABUSIVE_CONTENT rejections | — | High confidence on substance, medium on wording. Branded short domains are inference, not documented policy (see §16) |
| C19 | The "~2 marketing messages per user per day" figure is **not** in Meta's docs | — | Never state a number for the per-user cap |
| C20 | DPDP commencement dates and rule numbering differ across law-firm summaries; MeitY's gazette PDF was inaccessible | The notified Rules in the Gazette | No DPDP date may enter a client contract unverified (see §20) |
| C21 | Template pacing thresholds, portfolio pacing batch sizes and quality-rating cut-offs are **deliberately undisclosed by Meta** | Not knowable — detect empirically | Every threshold in this document is CITS product policy and is labelled as such |

**Standing rule.** Rate cards change quarterly (1 January, 1 April, 1 July, 1 October). Meta changed India rates at least twice in 2026. Rates must be configuration rows versioned by effective date, re-verified each quarter — never hardcoded.

## Appendix D — Glossary

| Term | Plain English |
|---|---|
| **Business portfolio** | The top-level Meta container (formerly "Business Manager") that owns WhatsApp accounts, apps, users and payment methods. CITS has one. Messaging limits and quality now pool here, so everything inside it shares one fate. |
| **WhatsApp Business Account (WABA)** | The account inside a portfolio that holds phone numbers and templates. Belongs to exactly one portfolio and can never be moved to another. Templates live here, not on the sender number. |
| **Business phone number** | A phone number registered for the WhatsApp API. It carries a display name and cannot also be used on consumer WhatsApp. |
| **Phone number ID** | The numeric identifier Meta gives that number. Every send and every media upload is addressed to it, not to the phone number itself. |
| **Cloud API** | Meta's hosted messaging API — the main way we send and receive messages. Meta runs the servers; we call HTTP endpoints. |
| **Marketing Messages API** | A second, separate send endpoint for marketing messages ("MM Lite") with delivery optimisation and click reporting. Requires its own per-account terms acceptance. Out of v1 scope but relevant to the roadmap (see §24). |
| **Template** | A pre-written message approved by Meta in advance, with blanks for personalisation. The only kind of message you can send to someone who has not messaged you recently. Owned by one client, living on exactly one WABA, usable by any sender number on that WABA. The 250/6,000 ceiling and the name-uniqueness rule are per WABA per language. |
| **Template category** | One of exactly three: Marketing, Utility, Authentication. The category sets the price. Meta can re-categorise a template after approval. |
| **Customer service window (CSW)** | The 24-hour period that opens when a person messages or calls the business, and resets on every new inbound message. Inside it you may send free-form messages; outside it, only templates. |
| **Messaging limit** | How many *different* people the business may start conversations with in a rolling 24 hours: 250 → 2,000 → 10,000 → 100,000 → unlimited. Since 2025-10-07 this is set at the portfolio level and shared by every number in it. |
| **Throughput** | How many messages per second a single number may send. Different from the messaging limit — one is a speed limit, the other a daily headcount. |
| **Quality rating** | Meta's green / yellow / red score for a number, computed from the last 7 days of user blocks, reports and other negative feedback. Meta publishes neither the algorithm nor the thresholds. |
| **Template pacing** | Meta releases a new or non-green template slowly, watching early reactions. Held messages either go out or are dropped if feedback is bad. |
| **Portfolio pacing** | Meta's version of the same idea applied to a whole portfolio, in force while the portfolio has sent under **500,000 template messages in a rolling 365 days**. A bad start can drop the entire remaining queue (error 135000). At CITS's year-one ceiling of just under 50,000 a month, the portfolio stays inside this regime for roughly the first ten months and leaves it only if that volume is sustained — so portfolio pacing is the **default** state in year one, not an edge case. The rolling-365-day count must be read as live data, never assumed. |
| **Saved segment** | A stored filter definition — for example "opted-in contacts in Pune tagged 'renewal'" — which is resolved to an actual list of contacts at the moment it is used. It is a separate entity from a contact group, it is in v1, and it is the only thing in v1 that behaves dynamically. Contact groups are static and explicit; there are no "dynamic groups". |
| **Attempt key** | An integer on every outbox row, starting at 1, incremented only by an explicit operator-initiated retry of a specific recipient set. Automatic retries inside the error-handling policy reuse the same attempt key, which is what makes them idempotent. A retry creates new rows under attempt key + 1 in the same campaign and shows in the same campaign report as a separate attempt. It is part of the outbox uniqueness key **(campaign_id, recipient_id, template_version_id, attempt_key)**. |
| **Frequency governor** | CITS's own per-contact ceiling on marketing messages in a rolling period, configurable per client and platform-wide (suggested default 4 per 30 days per client). Enforced in the pre-send suppression check and shown in the pre-flight summary as its own exclusion reason. Entirely separate from Meta's undisclosed per-user cap, which surfaces only as error 131049 after the fact. CITS product policy, not a Meta rule. |
| **Failure rate** | failed ÷ final recipients. Nothing else goes in the numerator. |
| **Non-delivery rate** | (failed + dropped by pacing + blocked by frequency cap) ÷ final recipients, always displayed with its three components itemised. Messages blocked by Meta's per-user marketing frequency cap (131049) and messages dropped by Meta's pacing are never summed into the failure rate. Any rate whose numerator was never captured inside Meta's 7-day analytics window renders as **"not captured"**, never as zero. |
| **Opt-in** | Documented permission from a person to receive WhatsApp messages from a named business. Having someone's phone number is not opt-in. |
| **Opt-out** | A request to stop receiving messages, made anywhere — on WhatsApp, by email, in person. It must be honoured for the WhatsApp channel regardless of where it arrived. |
| **Suppression** | Our own permanent do-not-send list, held in our database, unbounded. Consulted before every send. |
| **Blocking** | Meta's own per-number blocklist, capped at 64,000 users, and only usable on people who messaged the number in the last 24 hours. A different thing from suppression. |
| **Webhook** | An HTTPS endpoint we run that Meta calls to push events to us — incoming messages, delivery receipts, template approvals, account alerts. |
| **wamid** | The WhatsApp message ID Meta returns when it accepts a message. The key that ties a send to all its later status events; status events dedupe on **(wamid, status)** alone, so a redelivery carrying a different provider timestamp is still absorbed as a conflict. |
| **System user token** | A long-lived credential belonging to a machine account inside the portfolio, used by our server to call Meta's API. Never exposed to a browser. Health-checked every 6 hours. |
| **E.164** | The international phone number format: a plus sign, country code, then the number, with no spaces or punctuation — `+919876543210`. Always send numbers this way; omitting the plus makes Meta guess the country. |
| **Rate card** | Meta's per-message price list, by country and category, downloadable as a CSV from Business Manager. Changes quarterly. The authoritative source for every price in this document. |
