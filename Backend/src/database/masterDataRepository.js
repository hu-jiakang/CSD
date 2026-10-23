import { db } from "../database.js";

const getStatement = db.prepare(`
  SELECT payload, updated_at AS updatedAt
  FROM master_data_cache
  WHERE cache_key = ?
`);
const upsertStatement = db.prepare(`
  INSERT INTO master_data_cache (cache_key, payload, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(cache_key) DO UPDATE SET
    payload = excluded.payload,
    updated_at = excluded.updated_at
`);

export function getMasterDataCache(key) {
  const row = getStatement.get(key);
  if (!row) return null;
  try {
    return { data: JSON.parse(row.payload), updatedAt: row.updatedAt };
  } catch {
    return null;
  }
}

export function setMasterDataCache(key, data) {
  const updatedAt = new Date().toISOString();
  upsertStatement.run(key, JSON.stringify(data), updatedAt);
  return { data, updatedAt };
}

export function clearMasterDataCache(key = null) {
  if (key) db.prepare("DELETE FROM master_data_cache WHERE cache_key = ?").run(key);
  else db.exec("DELETE FROM master_data_cache");
}
