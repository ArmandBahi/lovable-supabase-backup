import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { LovableSupabaseBackupConfig } from "..";


export type FetchTableOptions = {
  /** PostgREST select list; default `*`. */
  select?: string;
  /** Page size used for pagination; default `1000`. */
  limit?: number;
  /** Start offset for pagination; default `0`. */
  offset?: number;
};

/**
 * Thin wrapper around the Supabase JS client for CLI-style usage (no session persistence).
 */
export class BackupsackupSupabaseService {
  private readonly config: LovableSupabaseBackupConfig;
  private readonly client: SupabaseClient;
  private accessToken: string | null = null;

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
    this.accessToken = data.session.access_token;
  }

  /**
   * Reads rows from a table via PostgREST. Requires policies that allow the current key/session.
   */
  async fetchTableRows<
    T extends Record<string, unknown> = Record<string, unknown>,
  >(table: string, options?: FetchTableOptions): Promise<T[]> {
    const select = options?.select ?? "*";
    const pageSize = options?.limit ?? 1000;
    if (pageSize <= 0) {
      throw new Error("fetchTableRows limit must be greater than 0");
    }
    let offset = options?.offset ?? 0;
    const rows: T[] = [];

    while (true) {
      const { data, error } = await this.client
        .from(table)
        .select(select)
        .range(offset, offset + pageSize - 1);
      if (error) {
        throw error;
      }

      const batch = ((data ?? []) as unknown) as T[];
      rows.push(...batch);

      if (batch.length < pageSize) {
        break;
      }
      offset += pageSize;
    }

    return rows;
  }

  /**
   * Fetches the list of tables from the view.
   */
  async fetchTablesList(): Promise<string[]> {
    const rows = await this.fetchTableRows(this.config.tablesListView);
    return rows.map((row: any) => row.table_name);
  }

  /**
   * Calls an authenticated edge function that returns users payload.
   */
  async fetchUsersFromEdgeFunction(
    functionUrl: string,
  ): Promise<Record<string, unknown>[]> {
    if (!this.accessToken) {
      throw new Error("Not authenticated. Call signInUser first.");
    }

    const response = await fetch(functionUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        apikey: this.config.anonKey,
      },
    });

    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(
        `list-users function failed (${response.status}): ${responseBody}`,
      );
    }

    const payload = (await response.json()) as {
      users?: Record<string, unknown>[];
    };
    if (!Array.isArray(payload.users)) {
      throw new Error("list-users function returned an invalid payload");
    }

    return payload.users;
  }
}
