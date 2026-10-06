import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';

const DB_NAME = 'RexaData';
const DB_VERSION = 1;
const KEY_PREFIX = 'rexa:';
const SECURE_SYNC_KEY = 'rexa.github.sync.v1';

let dbPromise = null;
let migrated = false;
let migrationPromise = null;

const native = () => Capacitor.isNativePlatform();

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function getDb() {
  if (!native()) return null;
  if (!dbPromise) {
    dbPromise = (async () => {
      const sqlite = new SQLiteConnection(CapacitorSQLite);
      const stored = await SecureStorage.get('rexa.sqlite.secret', false, false).catch(() => null);
      let secret = stored?.value || null;
      if (!secret) {
        secret = randomSecret();
        await SecureStorage.set('rexa.sqlite.secret', secret, false, false);
      }
      try {
        const secretStored = await sqlite.isSecretStored();
        if (!secretStored.result) await sqlite.setEncryptionSecret(secret);
      } catch {
        await sqlite.setEncryptionSecret(secret).catch(() => {});
      }
      const consistent = await sqlite.checkConnectionsConsistency();
      const exists = await sqlite.isConnection(DB_NAME, false);
      let db;
      if (consistent.result && exists.result) {
        db = await sqlite.retrieveConnection(DB_NAME, false);
      } else {
        db = await sqlite.createConnection(DB_NAME, true, 'secret', DB_VERSION, false);
      }
      await db.open();
      await db.execute(`
        CREATE TABLE IF NOT EXISTS kv_store (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_kv_store_updated_at ON kv_store(updated_at);
      `);
      return { sqlite, db };
    })().catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

export async function migrateLegacyStorage(keys = []) {
  if (!native() || migrated) return;
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    const ctx = await getDb().catch(() => null);
    if (!ctx) return;
    const legacyKeys = keys.length ? keys : Object.keys(localStorage);
    for (const key of legacyKeys) {
      if (!key || key.startsWith('rexa.github.')) continue;
      const raw = localStorage.getItem(key);
      if (raw == null) continue;
      const existing = await ctx.db.query('SELECT key FROM kv_store WHERE key = ?', [key]).catch(() => ({ values: [] }));
      if (!existing.values?.length) {
        await ctx.db.run(
          'INSERT OR IGNORE INTO kv_store(key,value,updated_at) VALUES(?,?,?)',
          [key, raw, new Date().toISOString()]
        );
      }
    }
    migrated = true;
  })().finally(() => { migrationPromise = null; });
  return migrationPromise;
}

export async function nativeLoad(key, fallback) {
  if (!native()) return fallback;
  await migrateLegacyStorage();
  const ctx = await getDb();
  const res = await ctx.db.query('SELECT value FROM kv_store WHERE key = ?', [key]);
  const raw = res.values?.[0]?.value;
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

export async function nativeSave(key, value) {
  if (!native()) return;
  const ctx = await getDb();
  await ctx.db.run(
    `INSERT INTO kv_store(key,value,updated_at) VALUES(?,?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    [key, JSON.stringify(value), new Date().toISOString()]
  );
}

export async function secureGet(key) {
  if (!native()) return null;
  try { return await SecureStorage.get(key, false, false); } catch { return null; }
}

export async function secureSet(key, value) {
  if (!native()) return;
  await SecureStorage.set(key, value, false, false);
}

export async function secureRemove(key) {
  if (!native()) return;
  await SecureStorage.remove(key, false);
}

export { SECURE_SYNC_KEY };
