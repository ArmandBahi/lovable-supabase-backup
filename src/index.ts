import * as path from "path";
import { config as loadEnv } from "dotenv";
import { SupabaseService } from "./services/supabase-service";
import { BackupFilesService } from "./services/backup-files-service";

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
  const supabaseSrvc = new SupabaseService(config);

  // Initialize the Backup Files service
  const backupFilesSrvc = new BackupFilesService(config);

  // Sign in with the user email and password
  await supabaseSrvc.signInUser(config.userEmail, config.userPassword);

  // Fetch the list of tables
  const tablesList = await supabaseSrvc.fetchTablesList();

  // Fetch the data for each table
  for (const table of tablesList) {
    const data = await supabaseSrvc.fetchTableRows(table);
    const success = backupFilesSrvc.writeTableCsv(table, data);
    if (success) {
      console.log(`Backuped ${data.length} rows from ${table}`);
    } else {
      console.error(`Failed to backup ${table}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
