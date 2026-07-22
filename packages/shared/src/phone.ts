import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/**
 * PRD §8 / DM-5 — every phone number is stored normalised to E.164, and the
 * raw operator input is kept alongside it so an import can always be
 * explained back to whoever uploaded the file.
 *
 * IMPORTANT — what this can and cannot tell you (PRD §2, §8):
 *
 * This validates that a string is a syntactically valid, dialable phone
 * number for its region. It does NOT and CANNOT tell you whether the number
 * has a WhatsApp account. Meta removed the only endpoint that answered that
 * question: the On-Premises API `/contacts` endpoint reached end-of-life on
 * 2025-10-23 and the Cloud API ships no replacement. Any "WhatsApp number
 * checker" on the market today is either scraping unofficially (which risks
 * the WABA) or is doing exactly what this function does and calling it
 * verification.
 *
 * The supported hygiene path is send-and-observe: send, then let Meta's
 * error 131026 ("message undeliverable") move a contact toward `suspect`
 * over repeated strikes (see DM-22 and the send worker). A number that
 * passes validation here may still have no WhatsApp account.
 */

export const DEFAULT_REGION: CountryCode = "IN";

export type NormalisedPhone = {
  ok: true;
  e164: string;
  countryCode: string | undefined;
  nationalNumber: string;
  raw: string;
};

export type PhoneError = {
  ok: false;
  raw: string;
  reason: "empty" | "unparseable" | "invalid";
  message: string;
};

/**
 * Normalise arbitrary operator/CSV input to E.164.
 *
 * `defaultRegion` is only consulted when the input has no `+` prefix — a
 * bare "9876543210" in an Indian client's import is an Indian number, but
 * "+14155552671" is always a US number regardless of the default.
 */
export function normalisePhone(raw: string, defaultRegion: CountryCode = DEFAULT_REGION): NormalisedPhone | PhoneError {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return { ok: false, raw, reason: "empty", message: "No phone number provided." };
  }

  // Strip the common spreadsheet decorations before parsing: Excel loves to
  // turn a phone column into "9.19876e+11" or wrap it in a leading
  // apostrophe, and operators paste numbers with spaces, dashes and
  // brackets. Anything that is not a digit or a leading + is noise here.
  const cleaned = trimmed.replace(/^'+/, "").replace(/[^\d+]/g, "");
  if (!cleaned || cleaned === "+") {
    return { ok: false, raw, reason: "unparseable", message: "Contains no digits." };
  }

  const parsed = parsePhoneNumberFromString(cleaned, cleaned.startsWith("+") ? undefined : defaultRegion);
  if (!parsed) {
    return { ok: false, raw, reason: "unparseable", message: "Not recognisable as a phone number." };
  }
  if (!parsed.isValid()) {
    return {
      ok: false,
      raw,
      reason: "invalid",
      message: `Not a valid number for ${parsed.country ?? "the detected region"}.`,
    };
  }

  return {
    ok: true,
    e164: parsed.number,
    countryCode: parsed.country,
    nationalNumber: parsed.nationalNumber,
    raw: trimmed,
  };
}

/**
 * Meta's API returns and expects WhatsApp IDs without the leading `+`
 * (e.g. "919876543210"), while everything we store is E.164 ("+91..."). The
 * two helpers below are the only sanctioned conversion points — do not
 * hand-slice the string anywhere else.
 */
export function toWhatsAppId(e164: string): string {
  return e164.replace(/^\+/, "");
}

export function fromWhatsAppId(waId: string): string {
  return waId.startsWith("+") ? waId : `+${waId}`;
}

/** Display helper: "+91 98765 43210" rather than a raw digit run. */
export function formatPhoneForDisplay(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  return parsed?.formatInternational() ?? e164;
}
