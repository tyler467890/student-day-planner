-- Calo unlock codes. Plain codes are never stored, only an HMAC-SHA-256
-- of the code with the CODE_PEPPER secret.
CREATE TABLE IF NOT EXISTS codes (
  id TEXT PRIMARY KEY,               -- short public id, e.g. c_8KD3M2PQ7R
  hash TEXT NOT NULL UNIQUE,         -- hex HMAC-SHA-256(CODE_PEPPER, code)
  created_at INTEGER NOT NULL,       -- unix seconds
  note TEXT NOT NULL DEFAULT '',     -- e.g. Etsy order number
  max_devices INTEGER NOT NULL DEFAULT 3,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS devices (
  code_id TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,           -- random id the app made, not tied to the person
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (code_id, device_id)
);

-- Failed tries, per hashed IP and per code, in fixed windows.
CREATE TABLE IF NOT EXISTS attempts (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
