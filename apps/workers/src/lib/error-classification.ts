import { and, eq, sql } from "drizzle-orm";
import { errorCodeClassification } from "@wacits/db";

/**
 * DM-27: (api_surface, code) is the key into error_code_classification —
 * the same numeric code means different things on different endpoints.
 * Shared between send-worker.ts (synchronous send-time failures) and
 * webhook-worker.ts (async delivery-status failures) so a given code is
 * classified identically regardless of which path Meta reports it on.
 */
export async function classifyError(
  tx: any,
  apiSurface: string,
  code: string,
): Promise<{ errorClass: string; countsToward131026: boolean; title: string }> {
  // Exact (surface, code) wins over the '*' wildcard row — DM-27's
  // precedence, since the same code means different things per endpoint.
  const rows = await tx
    .select()
    .from(errorCodeClassification)
    .where(
      and(
        eq(errorCodeClassification.code, code),
        sql`${errorCodeClassification.apiSurface} IN (${apiSurface}, '*')`,
      ),
    );

  const match = rows.find((r: any) => r.apiSurface === apiSurface) ?? rows.find((r: any) => r.apiSurface === "*");

  if (!match) {
    // An unknown code is treated as terminal rather than retried forever.
    console.warn(`[error-classification] no classification for (${apiSurface}, ${code}) — treating as TERMINAL.`);
    return { errorClass: "TERMINAL", countsToward131026: false, title: "Unclassified error" };
  }

  return {
    errorClass: match.errorClass,
    countsToward131026: match.countsToward131026Evidence === "true",
    title: match.title,
  };
}
