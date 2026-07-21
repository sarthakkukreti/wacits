# CITS WhatsApp Communication Manager

An internal, multi-client WhatsApp campaign and inbox platform for **Cyberlative IT Solutions**,
built directly on Meta's WhatsApp Cloud API — replacing dependence on AiSensy, WATI, Interakt,
Gallabox and Gupshup.

CITS serves scientific societies, journals, conferences, universities, agricultural associations
and professional bodies. This platform lets CITS hold each client's contact list, get message
templates approved by Meta, send campaigns at a controlled pace, and answer replies from a shared
inbox — with each client's data isolated from every other client's.

## Status

**Specification complete. No code written yet.**

The full product requirements document is at **[docs/PRD.md](docs/PRD.md)** — 25 sections, four
appendices, and 626 numbered, testable requirements. It is written to be implemented from directly.

## Before writing any code

Three things must happen first. All three are cheap, and skipping any of them costs real money or
real rework.

1. **Download Meta's INR rate card** from Business Manager. Meta publishes India pricing only as a
   downloadable CSV behind an authenticated account. Every rupee figure in the PRD is a secondary
   transcription marked `[Verify before build]` and must not be quoted to a client until confirmed.
2. **Re-check Meta's WhatsApp changelog.** It returned server errors throughout the research behind
   this document, so a very recent breaking change may not be captured.
3. **Run the three technical spikes in §3** — the BullMQ-on-Bun adapter, BullMQ's Valkey version
   requirements, and a 72-hour Bun soak test under representative bulk-send load. Each has a
   documented fallback if it fails.

Then work through **Appendix B**, the Meta onboarding runbook, and **Phase 0** in §25.

## Why the research matters

Meta changed this platform substantially during 2025 and 2026, and most guidance circulating
publicly is now wrong. Every platform fact in the PRD was verified against Meta's live primary
documentation on **21 July 2026**. The changes that reshaped the design:

- Pricing moved to **per-message, charged on delivery** (July 2025) — not per-conversation.
- Messaging limits are now pooled at the **business portfolio** level (October 2025), so every
  client shares one daily cap and one blast radius.
- **Service and in-window utility messages become chargeable on 1 October 2026.**
- Meta's **template and portfolio pacing** can hold or silently drop the remainder of a campaign,
  so campaigns must be interruptible and the first batch independently useful.
- **There is no way to check whether a number is on WhatsApp** before sending — the endpoint that
  did this was retired in October 2025.
- Quality drops **no longer downgrade** messaging limits, which invalidates every published
  warm-up schedule.

Anything the research could not confirm from a Meta source is marked `[Verify before build]`
rather than stated as fact. **Appendix C** collects all of them into one checklist.

## Planned stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16, its own container |
| API and workers | Bun (pinned `oven/bun:1.3.14`) with Hono |
| Database | PostgreSQL |
| Data access | Drizzle ORM `>=0.45.2` |
| Queue | BullMQ on Valkey, with pg-boss as documented fallback |
| Auth | Better Auth with the Organization plugin |
| File import | exceljs and papaparse — the npm `xlsx` package is banned |
| Phone numbers | libphonenumber-js, E.164 everywhere |
| Deployment | Docker Compose on one Linux VPS |

Version floors are not arbitrary: Drizzle below 0.45.2 carries a SQL-injection CVE, and the npm
`xlsx` package ships a knowingly vulnerable build. See §3 for the reasoning behind each choice.

## Key decisions

| Decision | Choice |
|---|---|
| WhatsApp account ownership | CITS owns the portfolio, the WABAs, and one number per client |
| Meta partner programme | None needed for v1 — no App Review, no Embedded Signup, no Tech Provider |
| Commercial model | Internal use only; usage and cost tracked per client, nobody billed |
| Year-one scale | Under 10 clients, under 50,000 messages per month |
| Channels | WhatsApp only |

§2 records these as a decision log with the risks CITS has explicitly accepted — including that the
research recommended *against* the chosen ownership model, and why it was overridden.
