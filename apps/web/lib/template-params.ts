/**
 * A template body carries positional placeholders written {{1}}, {{2}}, …
 * and Meta rejects any send whose parameter count does not match the
 * approved body exactly — error 132000, "number of localizable_params does
 * not match the expected number of params".
 *
 * That check bites hardest when a template is EDITED in WhatsApp Manager to
 * add a variable: every existing send path keeps sending zero parameters
 * and starts failing. Campaigns and one-to-one sends therefore share these
 * two operations rather than each carrying their own copy.
 */

export type TemplateComponent = {
  type: "body";
  parameters: { type: "text"; text: string }[];
};

/** Pulls the body text and its {{n}} placeholders out of a template's
 *  component array, so a caller can show a real preview and ask for the
 *  right number of variables instead of guessing. */
export function readTemplateBody(components: any): { body: string; placeholders: string[] } {
  const list = Array.isArray(components) ? components : [];
  const bodyComponent = list.find((c: any) => (c?.type ?? "").toUpperCase() === "BODY");
  const body: string = bodyComponent?.text ?? "";
  const placeholders = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]).filter((x): x is string => !!x);
  return { body, placeholders: [...new Set(placeholders)].sort((a, b) => Number(a) - Number(b)) };
}

/**
 * Builds the `components` payload for a ONE-TO-ONE send, where the operator
 * types a literal value for each placeholder. (A campaign differs: it stores
 * a mapping and the send worker resolves it per recipient.)
 *
 * Meta matches parameters positionally, so the ORDER of this array is the
 * contract — not the keys it was built from. Returning [] for a template
 * with no placeholders is deliberate: sending an empty body component is
 * itself a 132000.
 */
export function buildTemplateComponents(
  placeholders: string[],
  values: Record<string, string>,
): TemplateComponent[] {
  if (!placeholders.length) return [];
  return [
    {
      type: "body",
      parameters: placeholders.map((index) => ({ type: "text" as const, text: (values[index] ?? "").trim() })),
    },
  ];
}

/** Names the placeholders left blank. Meta treats an empty parameter as a
 *  validation failure (132012) rather than an empty string, so the UI must
 *  refuse to send instead of letting it through. */
export function missingParams(placeholders: string[], values: Record<string, string>): string[] {
  return placeholders.filter((index) => !(values[index] ?? "").trim());
}
