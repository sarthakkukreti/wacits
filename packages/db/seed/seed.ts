import { ERROR_CODE_SEED, PLATFORM_SETTING_DEFAULTS } from "@wacits/shared";
import { withSystemAccess } from "../src/tenant";
import { client, contactType, errorCodeClassification, optOutKeyword, platformSetting } from "../src/schema/index";

/**
 * Seeds the data that PRD §21.6 / TS-9 require to exist as editable rows,
 * not literals in code — plus one demo client workspace so the running
 * stack has something real to show. Idempotent: safe to re-run.
 *
 * Runs entirely under withSystemAccess() (SET ROLE wacits_platform): the
 * `client` table carries RLS scoped to its own id (see
 * db-security-setup.ts), so creating the FIRST row in it can never satisfy
 * a session-scoped policy — workspace creation is inherently a
 * platform-level operation, not something done from inside an existing
 * tenant session.
 */
async function seedPlatformSettings(tx: any) {
  for (const s of PLATFORM_SETTING_DEFAULTS) {
    await tx
      .insert(platformSetting)
      .values({
        key: s.key,
        valueType: s.valueType as any,
        value: s.value,
        description: s.description,
        minimum: "minimum" in s ? s.minimum : null,
      })
      .onConflictDoNothing({ target: platformSetting.key });
  }
  console.log(`Seeded ${PLATFORM_SETTING_DEFAULTS.length} platform settings.`);
}

async function seedErrorCodeClassifications(tx: any) {
  for (const row of ERROR_CODE_SEED) {
    await tx
      .insert(errorCodeClassification)
      .values({
        apiSurface: row.apiSurface,
        code: row.code,
        subcode: null,
        title: row.title,
        errorClass: row.errorClass as any,
        userFacingExplanation: row.userFacingExplanation,
        countsToward131026Evidence:
          "countsToward131026Evidence" in row ? String(row.countsToward131026Evidence) : "false",
      })
      .onConflictDoNothing({
        target: [errorCodeClassification.apiSurface, errorCodeClassification.code, errorCodeClassification.subcode],
      });
  }
  console.log(`Seeded ${ERROR_CODE_SEED.length} error code classification rows (Appendix A).`);
}

const DEFAULT_OPT_OUT_KEYWORDS = ["STOP", "UNSUBSCRIBE", "REMOVE", "OPT OUT", "DON'T MESSAGE", "DONT MESSAGE"];
const DEFAULT_CONTACT_TYPES = [
  "Member", "Author", "Reviewer", "Editor", "Delegate", "Speaker",
  "Committee Member", "Lead", "Client", "Sponsor", "Other",
];

/** §10 / §21.6 — seeded per client whenever a new workspace is created. */
export async function seedDefaultsForClient(tx: any, clientId: string) {
  for (const [i, name] of DEFAULT_CONTACT_TYPES.entries()) {
    await tx
      .insert(contactType)
      .values({ clientId, name, sortOrder: i })
      .onConflictDoNothing({ target: [contactType.clientId, contactType.name] });
  }
  for (const keyword of DEFAULT_OPT_OUT_KEYWORDS) {
    await tx
      .insert(optOutKeyword)
      .values({ clientId, keyword: keyword.toLowerCase(), direction: "opt_out", language: "en" })
      .onConflictDoNothing({ target: [optOutKeyword.clientId, optOutKeyword.keyword, optOutKeyword.language] });
  }
}

async function seedDemoClient(tx: any) {
  // §5: "CITS itself is a client workspace ... the model must not
  // special-case it." This is that workspace, used to prove the stack runs
  // end to end.
  const [demo] = await tx
    .insert(client)
    .values({ name: "Cyberlative IT Solutions (Internal)", slug: "cits-internal", status: "active" })
    .onConflictDoNothing({ target: client.slug })
    .returning();

  if (demo) {
    await seedDefaultsForClient(tx, demo.id);
    console.log(`Seeded demo client workspace: ${demo.name} (${demo.id})`);
  } else {
    console.log("Demo client workspace already exists, skipped.");
  }
}

await withSystemAccess(async (tx) => {
  await seedPlatformSettings(tx);
  await seedErrorCodeClassifications(tx);
  await seedDemoClient(tx);
});

console.log("Seed complete.");
process.exit(0);
