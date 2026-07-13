/**
 * Minimal async SQL port for the local (SQLite) DataStore. `SqliteDataStore`
 * depends on THIS, not on any concrete driver, so it can be:
 *   - unit-tested against a `node:sqlite`-backed driver (see the test), and
 *   - wired to `@tauri-apps/plugin-sql` in the desktop shell (Stage 5), whose
 *     `Database.select` / `Database.execute` already match this shape.
 *
 * Placeholders are positional `?` (both `node:sqlite` and sqlx-SQLite accept
 * them; the Tauri adapter translates to `$n` if its build requires it).
 */
export interface SqlRunResult {
  rowsAffected: number;
}

export interface SqlDriver {
  /** Run a query and return the rows as plain objects (column name → value). */
  select<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run a write/DDL statement. */
  execute(sql: string, params?: unknown[]): Promise<SqlRunResult>;
}
