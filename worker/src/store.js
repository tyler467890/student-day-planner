/**
 * Storage for the unlock Worker: one SQLite-backed Durable Object.
 *
 * Why not KV: KV is eventually consistent, so two devices activating close
 * together could both read "2 devices" and both write slot 3 (or one write
 * could wipe the other). A Durable Object runs one request at a time, so the
 * 3-device limit and the wrong-guess counters are exact. SQLite Durable
 * Objects are on Cloudflare's free plan (nova-api uses one for its login
 * limiter too).
 *
 * makeDb(env) returns a tiny D1-style wrapper (prepare/bind/first/run/all,
 * batch) so the SQL in index.js reads like plain D1 code. Each statement is
 * one RPC call into the object and runs atomically there.
 */
import { DurableObject } from 'cloudflare:workers';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS codes (
     id TEXT PRIMARY KEY,
     hash TEXT NOT NULL UNIQUE,
     created_at INTEGER NOT NULL,
     note TEXT NOT NULL DEFAULT '',
     max_devices INTEGER NOT NULL DEFAULT 3,
     revoked INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS devices (
     code_id TEXT NOT NULL,
     device_id TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     last_seen INTEGER NOT NULL,
     PRIMARY KEY (code_id, device_id)
   )`,
  `CREATE TABLE IF NOT EXISTS attempts (
     key TEXT PRIMARY KEY,
     window_start INTEGER NOT NULL,
     count INTEGER NOT NULL
   )`,
];

export class CaloStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      for (const s of SCHEMA) ctx.storage.sql.exec(s);
    });
  }

  #one(sql, params) {
    const rows = this.ctx.storage.sql.exec(sql, ...params).toArray();
    const changes = this.ctx.storage.sql.exec('SELECT changes() AS n').one().n;
    return { results: rows, meta: { changes } };
  }

  /** Run one statement. */
  query(sql, params = []) {
    return this.#one(sql, params);
  }

  /** Run several statements in one transaction. */
  batch(list) {
    return this.ctx.storage.transactionSync(() => list.map(({ sql, params }) => this.#one(sql, params || [])));
  }

  /** Test helper: wipe everything. */
  reset() {
    for (const t of ['devices', 'codes', 'attempts']) this.ctx.storage.sql.exec(`DELETE FROM ${t}`);
    return true;
  }
}

export function storeStub(env) {
  return env.STORE.get(env.STORE.idFromName('calo-unlock-v1'));
}

export function makeDb(env) {
  const stub = storeStub(env);
  const prepare = (sql) => {
    const stmt = {
      sql,
      params: [],
      bind(...params) { return { ...stmt, params }; },
      async first() { return (await stub.query(this.sql, this.params)).results[0] ?? null; },
      async run() { return stub.query(this.sql, this.params); },
      async all() { return stub.query(this.sql, this.params); },
    };
    return stmt;
  };
  return {
    prepare,
    batch: (stmts) => stub.batch(stmts.map((s) => ({ sql: s.sql, params: s.params }))),
  };
}
