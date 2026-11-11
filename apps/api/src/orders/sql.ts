import { type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * `book` columns are a domain over an enum (`ledger_book`), which Postgres cannot compare with an
 * untyped parameter. Compare as text instead.
 */
export const bookIs = (column: PgColumn, book: string): SQL => sql`${column}::text = ${book}`;
