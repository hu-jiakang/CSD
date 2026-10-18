import { db } from "../database.js";

const now = () => new Date().toISOString();

const upsertCustomer = db.prepare(`
  INSERT INTO kingdee_customers (customer_code, payload, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(customer_code) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at
`);
const upsertStore = db.prepare(`
  INSERT INTO kingdee_stores (store_code, payload, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(store_code) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at
`);
const upsertEmployee = db.prepare(`
  INSERT INTO kingdee_employees (employee_no, payload, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(employee_no) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at
`);

const upsertBinding = db.prepare(`
  INSERT INTO kingdee_bindings (binding_key, store_code, promoter_code, promoter_name, role_code, role_name, main_store, inactive_ps_nht_fl, payload, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(binding_key) DO UPDATE SET
    store_code=excluded.store_code, promoter_code=excluded.promoter_code, promoter_name=excluded.promoter_name,
    role_code=excluded.role_code, role_name=excluded.role_name, main_store=excluded.main_store,
    inactive_ps_nht_fl=excluded.inactive_ps_nht_fl, payload=excluded.payload, updated_at=excluded.updated_at
`);

const upsertDepartmentStatement = db.prepare(`
  INSERT INTO kingdee_departments (department_key, department_code, department_name, payload, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(department_key) DO UPDATE SET
    department_code=excluded.department_code,
    department_name=excluded.department_name,
    payload=excluded.payload,
    updated_at=excluded.updated_at
`);

function parse(row) {
  if (!row?.payload) return null;
  try { return JSON.parse(row.payload); } catch { return null; }
}

export function replaceCustomers(rows) {
  const stamp = now();
  db.exec("BEGIN"); try { for (const row of rows) { const code = String(row?.FNumber ?? "").trim(); if (code) upsertCustomer.run(code, JSON.stringify(row), stamp); } db.exec("COMMIT"); } catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
}

export function replaceStores(rows) {
  const stamp = now();
  db.exec("BEGIN"); try { for (const row of rows) { const code = String(row?.FNumber ?? "").trim(); if (code) upsertStore.run(code, JSON.stringify(row), stamp); } db.exec("COMMIT"); } catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
}

export function replaceEmployees(rows) {
  const stamp = now();
  db.exec("BEGIN"); try { for (const row of rows) { const no = String(row?.FStaffNumber ?? "").trim(); if (no) upsertEmployee.run(no, JSON.stringify(row), stamp); } db.exec("COMMIT"); } catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
}

export function replaceBindings(rows) {
  const stamp = now();
  db.exec("BEGIN");
  try {
    // Binding is a current-state master. Replace the local snapshot so
    // deleted/removed Kingdee bindings do not remain in SQLite.
    db.exec("DELETE FROM kingdee_bindings");
    for (const row of rows) {
      const storeCode = String(row?.storeCode ?? "").trim();
      const promoterCode = String(row?.promoterCode ?? "").trim();
      if (!storeCode || !promoterCode) continue;
      const key = String(row?.bindingKey || `${storeCode}\u0000${promoterCode}\u0000${String(row?.mainStore ?? "").trim()}`).trim();
      upsertBinding.run(key, storeCode, promoterCode, String(row?.promoterName ?? "").trim(), String(row?.roleCode ?? "").trim(), String(row?.roleName ?? "").trim(), String(row?.mainStore ?? "").trim(), row?.inactivePsNhtFl ? 1 : 0, JSON.stringify(row), stamp);
    }
    db.exec("COMMIT");
  } catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
}

export function getAllBindings() {
  return db.prepare("SELECT payload FROM kingdee_bindings ORDER BY store_code ASC, promoter_code ASC").all().map(parse).filter(Boolean);
}

export function upsertDepartment(row) {
  const code = String(row?.FNumber ?? "").trim();
  const name = String(row?.FName ?? "").trim();
  const key = code || name;
  if (!key) return;
  upsertDepartmentStatement.run(key, code, name, JSON.stringify(row), now());
}

export function getAllCustomers() {
  return db.prepare("SELECT payload FROM kingdee_customers ORDER BY customer_code ASC").all().map(parse).filter(Boolean);
}
export function getAllStores() {
  return db.prepare("SELECT payload FROM kingdee_stores ORDER BY store_code ASC").all().map(parse).filter(Boolean);
}
export function getEmployee(employeeNo) {
  const row = db.prepare("SELECT payload FROM kingdee_employees WHERE employee_no = ?").get(String(employeeNo ?? "").trim());
  return parse(row);
}
export function getDepartment(key) {
  const value = String(key ?? "").trim();
  const row = db.prepare("SELECT payload FROM kingdee_departments WHERE department_code = ? OR department_name = ? LIMIT 1").get(value, value);
  return parse(row);
}
export function getDepartments(keys = []) {
  const unique = [...new Set(keys.map((x) => String(x ?? "").trim()).filter(Boolean))];
  const result = {};
  for (const key of unique) {
    const row = db.prepare("SELECT payload FROM kingdee_departments WHERE department_code = ? OR department_name = ? LIMIT 1").get(key, key);
    const data = parse(row);
    if (data) {
      result[key] = data;
      if (data.FNumber) result[String(data.FNumber).trim()] = data;
      if (data.FName) result[String(data.FName).trim()] = data;
    }
  }
  return result;
}

export function getKingdeeDataStats() {
  return {
    customers: db.prepare("SELECT COUNT(*) AS count, MAX(updated_at) AS updatedAt FROM kingdee_customers").get(),
    stores: db.prepare("SELECT COUNT(*) AS count, MAX(updated_at) AS updatedAt FROM kingdee_stores").get(),
    employees: db.prepare("SELECT COUNT(*) AS count, MAX(updated_at) AS updatedAt FROM kingdee_employees").get(),
    departments: db.prepare("SELECT COUNT(*) AS count, MAX(updated_at) AS updatedAt FROM kingdee_departments").get(),
    bindings: db.prepare("SELECT COUNT(*) AS count, MAX(updated_at) AS updatedAt FROM kingdee_bindings").get(),
  };
}

export function createSyncLog(syncType) {
  const result = db.prepare("INSERT INTO kingdee_sync_log(sync_type, started_at, status) VALUES (?, ?, 'running')").run(syncType, now());
  return Number(result.lastInsertRowid);
}
export function completeSyncLog(id, fetched, saved) {
  db.prepare("UPDATE kingdee_sync_log SET completed_at=?, status='success', records_fetched=?, records_saved=? WHERE id=?").run(now(), fetched, saved, id);
}
export function failSyncLog(id, error) {
  db.prepare("UPDATE kingdee_sync_log SET completed_at=?, status='failed', error_message=? WHERE id=?").run(now(), error?.message || String(error), id);
}
