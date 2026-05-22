import * as path from "path";
import { config as loadEnv } from "dotenv";
import { BackupsackupSupabaseService } from "./services/backup-supabase-service";
import { BackupFilesService } from "./services/backup-files-service";
import { RecoverSupabaseService } from "./services/recover-supabase-service";
import { RecoverFilesService } from "./services/recover-files-service";

const envPath = path.resolve(__dirname, "..", ".env");
loadEnv({ path: envPath });

export type LovableSupabaseBackupConfig = {
  backupMode: boolean;
  recoverMode: boolean;
  url: string;
  anonKey: string;
  userEmail: string;
  userPassword: string;
  tablesListView: string;
  migrationsFolder: string;
  recoverPgHost: string;
  recoverPgPort: string;
  recoverPgUser: string;
  recoverPgPassword: string;
  recoverPgDatabase: string;
  listUsersFunctionUrl?: string;
  recoverDbUrl?: string;
  recoverDbKey?: string;
  recoverDbUser?: string;
  recoverDbUserId?: string;
  recoverDbPassword?: string;
  postRecoverySql?: string;
  recoverDbListUsersFunctionUrl?: string;
  recoverDbCreateUserFunctionUrl?: string;
};

for (const key of [
  "BACKUP_MODE",
  "RECOVER_MODE",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_USER_EMAIL",
  "SUPABASE_USER_PASSWORD",
  "TABLES_LIST_VIEW",
  "MIGRATIONS_FOLDER",
  "RECOVER_PG_HOST",
  "RECOVER_PG_PORT",
  "RECOVER_PG_USER",
  "RECOVER_PG_PASSWORD",
  "RECOVER_PG_DATABASE"]) {
  if (!process.env[key]) {
    console.error(`Missing ${key} in .env file.`);
    process.exit(1);
  }
}

const config: LovableSupabaseBackupConfig = {
  backupMode: process.env.BACKUP_MODE as string === "true",
  recoverMode: process.env.RECOVER_MODE as string === "true",
  url: process.env.VITE_SUPABASE_URL as string,
  anonKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
  userEmail: process.env.SUPABASE_USER_EMAIL as string,
  userPassword: process.env.SUPABASE_USER_PASSWORD as string,
  tablesListView: process.env.TABLES_LIST_VIEW as string,
  listUsersFunctionUrl: process.env.LIST_USERS_FUNCTION_URL as string | undefined,
  migrationsFolder: process.env.MIGRATIONS_FOLDER as string,
  recoverPgHost: process.env.RECOVER_PG_HOST as string,
  recoverPgPort: process.env.RECOVER_PG_PORT as string,
  recoverPgUser: process.env.RECOVER_PG_USER as string,
  recoverPgPassword: process.env.RECOVER_PG_PASSWORD as string,
  recoverPgDatabase: process.env.RECOVER_PG_DATABASE as string,
  recoverDbUrl: process.env.RECOVER_DB_URL as string | undefined,
  recoverDbKey: process.env.RECOVER_DB_KEY as string | undefined,
  recoverDbUser: process.env.RECOVER_DB_USER as string | undefined,
  recoverDbUserId: process.env.RECOVER_DB_USER_ID as string | undefined,
  recoverDbPassword: process.env.RECOVER_DB_PASSWORD as string | undefined,
  postRecoverySql: process.env.POST_RECOVERY_SQL as string | undefined,
  recoverDbListUsersFunctionUrl: process.env.RECOVER_DB_LIST_USERS_FUNCTION_URL as string | undefined,
  recoverDbCreateUserFunctionUrl: process.env.RECOVER_DB_CREATE_USER_FUNCTION_URL as string | undefined,
};

async function main(): Promise<void> {
  if (config.backupMode) {
    await backupProductionDatabase();
  }
  if (config.recoverMode) {
    await recoverProductionDatabase();
  }
}

/**
 * Backup the production database to the local filesystem.
 */
async function backupProductionDatabase(): Promise<void> {
  // Initialize the Supabase service
  const supabaseSrvc = new BackupsackupSupabaseService(config);

  // Initialize the Backup Files service
  const backupFilesSrvc = new BackupFilesService(config);

  // Sign in with the user email and password
  await supabaseSrvc.signInUser(config.userEmail, config.userPassword);

  // Fetch the list of tables
  const tablesList = await supabaseSrvc.fetchTablesList();

  // Fetch the data for each table
  for (const table of tablesList) {
    const data = await supabaseSrvc.fetchTableRows(table);
    const success = backupFilesSrvc.writeTableJson(table, data);
    if (success) {
      console.log(`Backuped ${data.length} rows from ${table}`);
    } else {
      console.error(`Failed to backup ${table}`);
    }
  }

  // Backup the users from the edge function
  if (config.listUsersFunctionUrl) {
    const users = await supabaseSrvc.fetchUsersFromEdgeFunction(
      config.listUsersFunctionUrl,
    );
    const success = backupFilesSrvc.writeJsonFile("users", users);
    if (success) {
      console.log(`Backuped ${users.length} users from edge function`);
    } else {
      console.error("Failed to backup users");
    }
  }
}

/**
 * Recover the production database from the local filesystem.
 */
async function recoverProductionDatabase(): Promise<void> {
  // Initialize the Recover Supabase service
  const recoverSupabaseSrvc = new RecoverSupabaseService(config);

  // Initialize the Recover Files service
  const recoverFilesSrvc = new RecoverFilesService(config);

  // Fetch the list of migrations
  const migrationsList = recoverFilesSrvc.getMigrationsList();
  console.log(`Found ${migrationsList.length} migrations in the migrations folder`);

  // Assert that the recover database is reachable and accepts credentials
  const isConnected = await recoverSupabaseSrvc.assertConnection();
  if (!isConnected) {
    console.error("Failed to connect to the recover database");
    process.exit(1);
  } else {
    console.log("Connected to the recover database");
  }

  // Recreate the public schema
  const success = await recoverSupabaseSrvc.recreatePublicSchema();
  if (success) {
    console.log("Public schema recreated successfully");
  } else {
    console.error("Failed to recreate the public schema");
    process.exit(1);
  }

  /**
   * Recover the database
   */

  // Play the migrations
  await recoverSupabaseSrvc.playMigrations(migrationsList);
  console.log(`Played ${migrationsList.length} migrations in the recover database`);

  // Execute the grants
  await recoverSupabaseSrvc.executeGrants();
  console.log("Grants successfully executed");

  /**
   * Recover the users
   */

  // Recover db user
  if (config.recoverDbUser && config.recoverDbUserId) {
    await recoverSupabaseSrvc.createRecoverDbAdminUser(config.recoverDbUser, config.recoverDbUserId);
    console.log(`Recover db user created: ${config.recoverDbUser}`);
  } else {
    console.error("Missing recover db user credentials");
    process.exit(1);
  }

  // Get the last backup users
  if (config.recoverDbListUsersFunctionUrl && config.recoverDbCreateUserFunctionUrl) {

    // Users already in the database
    const usersInDatabase = await recoverSupabaseSrvc.fetchRecoverDbExistingUsers(
      config.recoverDbListUsersFunctionUrl,
    );
    console.log(`Found ${usersInDatabase.length} users in the database`);

    // Users tu send
    const lastBackupUsers = recoverFilesSrvc.getLastBackupUsers();
    console.log(`Found ${lastBackupUsers.length} users in the last backup`);

    // Users to create
    const usersToCreate = lastBackupUsers.filter((user) => !usersInDatabase.some((u) => u.email === user.email));
    console.log(`Found ${usersToCreate.length} users to create`);

    // Create the users
    await recoverSupabaseSrvc.createRecoverDbUsers(
      config.recoverDbCreateUserFunctionUrl,
      usersToCreate,
    );
    console.log(`Created ${usersToCreate.length} users in the recover database`);
  }

  /**
   * Reimport the data from the backup files
   */

  // Reimport the data from the backup files
  const getLastBackupDatas = recoverFilesSrvc.getLastBackupDatas();
  console.log(`Last backup tables: ${getLastBackupDatas.length}`);
  await recoverSupabaseSrvc.importDataFromBackupDatas(getLastBackupDatas);
  console.log(`Imported ${getLastBackupDatas.length} tables in the recover database`);

  // Post recovery SQL
  if (config.postRecoverySql) {
    await recoverSupabaseSrvc.executePostRecoverySql(config.postRecoverySql);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
