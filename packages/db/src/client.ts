import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

// TS-8: the application must refuse to start if any required secret is
// missing, rather than starting with a default.
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Refusing to start (see PRD §3.4 / TS-8) — copy .env.example to .env first.",
  );
}

const queryClient = postgres(DATABASE_URL, { max: 10 });

export const db = drizzle(queryClient, { schema });
export type Database = typeof db;
export { schema };
