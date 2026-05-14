import * as path from "path";
import { config as loadEnv } from "dotenv";
import { SupabaseService } from "./supabase-service";

const envPath = path.resolve(__dirname, "..", ".env");
loadEnv({ path: envPath });

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const userEmail = process.env.SUPABASE_USER_EMAIL;
const userPassword = process.env.SUPABASE_USER_PASSWORD;

const TEST_TABLE = "profiles";

async function main(): Promise<void> {
  if (!url || !anonKey) {
    console.error(
      "Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY (see .env.sample).",
    );
    process.exit(1);
  }

  const supabase = new SupabaseService({ url, anonKey });

  if (userEmail && userPassword) {
    await supabase.signInUser(userEmail, userPassword);
    console.log("Signed in with SUPABASE_USER_* credentials.");
  }

  const rows = await supabase.fetchTableRows(TEST_TABLE, { limit: 5 });
  console.log(`Sample rows from "${TEST_TABLE}" (limit 5):`, rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
