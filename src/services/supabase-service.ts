import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { LovableSupabaseBackupConfig } from "..";


export type FetchTableOptions = {
  /** PostgREST select list; default `*`. */
  select?: string;
  limit?: number;
  offset?: number;
};

/**
 * Thin wrapper around the Supabase JS client for CLI-style usage (no session persistence).
 */
export class SupabaseService {
  private readonly config: LovableSupabaseBackupConfig;
  private readonly client: SupabaseClient;

  constructor(config: LovableSupabaseBackupConfig) {
    this.config = config;
    this.client = createClient(this.config.url, this.config.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  /**
   * Signs in with email/password so subsequent queries use that JWT (RLS as that user).
   */
  async signInUser(email: string, password: string): Promise<void> {
    const { data, error } = await this.client.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      throw error;
    }
    if (!data.session) {
      throw new Error("signInWithPassword returned no session");
    }
  }

  /**
   * Reads rows from a table via PostgREST. Requires policies that allow the current key/session.
   */
  async fetchTableRows<
    T extends Record<string, unknown> = Record<string, unknown>,
  >(table: string, options?: FetchTableOptions): Promise<T[]> {
    const select = options?.select ?? "*";
    let query = this.client.from(table).select(select);

    if (options?.limit != null && options.offset != null) {
      query = query.range(
        options.offset,
        options.offset + options.limit - 1,
      );
    } else if (options?.limit != null) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }
    return ((data ?? []) as unknown) as T[];
  }

  /**
   * Fetches the list of tables from the view.
   */
  async fetchTablesList(): Promise<string[]> {
    const rows = await this.fetchTableRows(this.config.tablesListView);
    return rows.map((row: any) => row.table_name);
  }
}
