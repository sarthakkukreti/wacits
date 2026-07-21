import { defineConfig } from "drizzle-kit";

// TS-2: the build must fail if drizzle-orm resolves below 0.45.2 (see package.json
// dependency floor and the CI dependency check referenced in TS-3/TS-2).
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/wacits_dev",
  },
  // DM-19: migrations are hand-editable SQL files committed to the repo,
  // applied in order, never edited after being applied to production.
  // drizzle-kit generates the starting point; review before committing.
  verbose: true,
  strict: true,
});
