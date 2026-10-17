import Database from 'better-sqlite3';

export type Db = Database.Database;

/** Accepts ':memory:', 'sqlite://', 'sqlite:///./x.db', 'sqlite:////abs/x.db' or a plain path. */
export function resolveDbPath(url: string): string {
  if (url === ':memory:' || url === 'sqlite://' || url === 'sqlite:///:memory:') return ':memory:';
  if (url.startsWith('sqlite:///')) return url.slice('sqlite:///'.length) || ':memory:';
  return url;
}

export function openDb(url: string): Db {
  const path = resolveDbPath(url);
  const db = new Database(path);
  if (path !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
