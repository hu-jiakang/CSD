import "dotenv/config";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const configuredPath = String(process.env.DATABASE_PATH || "./data/kingdee.db").trim();
const databasePath = path.resolve(configuredPath);
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

export const db = new DatabaseSync(databasePath);

// Kingdee SQLite is the local serving/synchronization database only.
// Application authentication credentials and sessions are stored separately
// in customer-store-dashboard.db, matching the established EKSBASE pattern.
const authDatabasePath = path.resolve(
  String(process.env.AUTH_DATABASE_PATH || "./data/customer-store-dashboard.db").trim()
);
fs.mkdirSync(path.dirname(authDatabasePath), { recursive: true });
export const authDb = new DatabaseSync(authDatabasePath);

authDb.exec(`
CREATE TABLE IF NOT EXISTS export_tickets (
  ticket TEXT PRIMARY KEY,
  employee_no TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS credentials (
  employee_no TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  employee_no TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS kingdee_customers (
  customer_code TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kingdee_stores (
  store_code TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kingdee_employees (
  employee_no TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kingdee_bindings (
  binding_key TEXT PRIMARY KEY,
  store_code TEXT NOT NULL,
  promoter_code TEXT NOT NULL,
  promoter_name TEXT,
  role_code TEXT,
  role_name TEXT,
  main_store TEXT,
  inactive_ps_nht_fl INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kingdee_departments (
  department_key TEXT PRIMARY KEY,
  department_code TEXT,
  department_name TEXT,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kingdee_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  records_fetched INTEGER DEFAULT 0,
  records_saved INTEGER DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_kingdee_customers_updated_at ON kingdee_customers(updated_at);
CREATE INDEX IF NOT EXISTS idx_kingdee_stores_updated_at ON kingdee_stores(updated_at);
CREATE INDEX IF NOT EXISTS idx_kingdee_employees_updated_at ON kingdee_employees(updated_at);
CREATE INDEX IF NOT EXISTS idx_kingdee_bindings_store_code ON kingdee_bindings(store_code);
CREATE INDEX IF NOT EXISTS idx_kingdee_bindings_promoter_code ON kingdee_bindings(promoter_code);
CREATE INDEX IF NOT EXISTS idx_kingdee_departments_code ON kingdee_departments(department_code);
CREATE INDEX IF NOT EXISTS idx_kingdee_departments_name ON kingdee_departments(department_name);

-- Legacy cache tables are retained for backward compatibility with existing
-- dashboard code and are stored in the same Kingdee SQLite database.
CREATE TABLE IF NOT EXISTS master_data_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_master_data_cache_updated_at
  ON master_data_cache(updated_at);
CREATE TABLE IF NOT EXISTS department_territory_cache (
  department_code TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

console.log(`[DATABASE] Kingdee SQLite connected: ${databasePath}`);
console.log(`[DATABASE] Authentication SQLite connected: ${authDatabasePath}`);
console.log("[DATABASE] Customer & Store Kingdee data tables ready");
