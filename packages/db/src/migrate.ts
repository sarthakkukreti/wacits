import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// DM-19: migrations are plain, hand-editable SQL files, applied in order,
// never edited after being applied to production.
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Refusing to run migrations.");
}

const sql = postgres(DATABASE_URL, { max: 1 });
const db = drizzle(sql);

console.log(`Applying migrations from ./migrations against ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")} ...`);
await migrate(db, { migrationsFolder: "./migrations" });
console.log("Migrations applied.");
await sql.end();
