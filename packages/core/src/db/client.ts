import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;

export function createDb(url: string): { db: Db; close(): Promise<void> } {
  const client = postgres(url, { max: 5 });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end() };
}
