import * as path from "path";
import { config as loadEnv } from "dotenv";
import { SupabaseService } from "./supabase-service";

const envPath = path.resolve(__dirname, "..", ".env");
loadEnv({ path: envPath });

export type LovableSupabaseBackupConfig = {
  url: string;
  anonKey: string;
  userEmail: string;
  userPassword: string;
  tablesListView: string;
};

for (const key of ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_USER_EMAIL", "SUPABASE_USER_PASSWORD", "TABLES_LIST_VIEW"]) {
  if (!process.env[key]) {
    console.error(`Missing ${key} in .env file.`);
    process.exit(1);
  }
}

const config: LovableSupabaseBackupConfig = {
  url: process.env.VITE_SUPABASE_URL as string,
  anonKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
  userEmail: process.env.SUPABASE_USER_EMAIL as string,
  userPassword: process.env.SUPABASE_USER_PASSWORD as string,
  tablesListView: process.env.TABLES_LIST_VIEW as string,
};

async function main(): Promise<void> {
  // Initialize the Supabase service
  const supabase = new SupabaseService(config);

  // Sign in with the user email and password
  await supabase.signInUser(config.userEmail, config.userPassword);

  // Fetch the list of tables
  const tablesList = await supabase.fetchTablesList();

  // Fetch the data for each table
  for (const table of tablesList) {
    const data = await supabase.fetchTableRows(table);
    console.log(`Fetched ${data.length} rows from ${table}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
