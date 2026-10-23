import "dotenv/config";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./src/config/env.js";
import { KingdeeClient } from "./src/kingdee/kingdeeClient.js";
import { CUSTOMER_FIELDS, STORE_FIELDS, DEPARTMENT_FIELDS } from "./src/kingdee/fieldMaps.js";
import { buildOrganizationFilter, buildStoreFilter, rowsToObjects, escapeKingdeeValue } from "./src/utils/kingdee.js";

const PAGE_SIZE = 1000;
const FILTER_BATCH_SIZE = 50;
const BINDING_FIELDS = ["FSTOCK.FNumber", "FSR.FNumber", "FSR.FName", "F_RTA_MainStore"];
const EMPLOYEE_FIELDS = ["FStaffNumber", "FName", "F_RTA_Role.FName", "F_RTA_Role.FNumber", "FForbidStatus", "F_RTA_ResignDate"];
const ROLE_NAMES = { SP: "Promoter", NHT: "New Hire Trainee", FL: "Frontliner" };
const ALLOWED_ROLES = new Set(Object.keys(ROLE_NAMES));
const clean = (v) => String(v ?? "").trim();

function employeeInactive(row) {
  const status = clean(row?.FForbidStatus).toUpperCase();
  if (status && status !== "A") return true;
  const d = clean(row?.F_RTA_ResignDate);
  if (!d) return false;
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0); date.setHours(0, 0, 0, 0);
  return date < today;
}

async function main() {
  const dbPath = resolve(String(process.env.DATABASE_PATH || "./data/kingdee.db").trim());
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const client = new KingdeeClient(config.kingdee);
  const scope = config.scope;
  const queryAll = async (formId, fieldKeys, filterString, orderString = "FNumber ASC") => {
    const all = []; let startRow = 0;
    while (true) {
      const rows = await client.executeBillQuery({ formId, fieldKeys, filterString, orderString, startRow, limit: PAGE_SIZE });
      all.push(...rowsToObjects(rows, fieldKeys));
      if (rows.length < PAGE_SIZE) break;
      startRow += PAGE_SIZE;
    }
    return all;
  };
  const loadLocal = (table, keyColumn) => db.prepare(`SELECT ${keyColumn} AS key, payload FROM ${table}`).all().map(r => ({ key: String(r.key), payload: JSON.parse(r.payload) }));
  const compareFields = (label, liveRows, localRows, liveKey, fields, localPayload = x => x, livePayload = x => x, fieldValue = (x, f) => x?.[f]) => {
    const live = new Map();
    for (const row of liveRows) { const key = String(liveKey(row) ?? ""); if (key && !live.has(key)) live.set(key, row); }
    const local = new Map(localRows.map(row => [row.key, row.payload]));
    const missing = [...live.keys()].filter(k => !local.has(k));
    const extra = [...local.keys()].filter(k => !live.has(k));
    const changed = [];
    for (const key of live.keys()) {
      if (!local.has(key)) continue;
      const a = livePayload(live.get(key)); const b = localPayload(local.get(key));
      const changedFields = fields.filter(f => clean(fieldValue(a, f)) !== clean(fieldValue(b, f)));
      if (changedFields.length) changed.push({ key, fields: changedFields });
    }
    return { dataset: label, liveUnique: live.size, sqliteRows: local.size, missingInSQLite: missing.length, extraInSQLite: extra.length, changedRecords: changed.length, samples: { missingInSQLite: missing.slice(0, 15), extraInSQLite: extra.slice(0, 15), changed: changed.slice(0, 15) } };
  };

  try {
    console.log(`Comparison scope: Organization ${scope.organization}`);
    console.log("Mode: read-only; no SQLite writes will be performed.");
    const orgFilter = buildOrganizationFilter(scope.organizationField, scope.organization);
    const [customers, stores, departments, bindingRows] = await Promise.all([
      queryAll("BD_Customer", CUSTOMER_FIELDS, orgFilter),
      queryAll("BD_STOCK", STORE_FIELDS, buildStoreFilter(scope.organizationField, scope.organization)),
      queryAll("BD_Department", DEPARTMENT_FIELDS, orgFilter, "FNumber ASC"),
      queryAll("RTA_StoreSR_Binding", BINDING_FIELDS, buildOrganizationFilter("F_RTA_UseOrgId.FNumber", scope.organization), "FSTOCK.FNumber ASC,FSR.FNumber ASC")
    ]);

    const promoterCodes = [...new Set(bindingRows.map(r => clean(r["FSR.FNumber"])).filter(Boolean))];
    const employeeMap = new Map();
    for (let i = 0; i < promoterCodes.length; i += FILTER_BATCH_SIZE) {
      const batch = promoterCodes.slice(i, i + FILTER_BATCH_SIZE);
      const employeeFilter = batch.map(c => `FStaffNumber = '${escapeKingdeeValue(c)}'`).join(" OR ");
      const rows = await queryAll("BD_Empinfo", EMPLOYEE_FIELDS, `(${orgFilter}) AND (${employeeFilter})`, "FStaffNumber ASC");
      for (const row of rows) { const code = clean(row.FStaffNumber).toUpperCase(); if (code) employeeMap.set(code, row); }
    }
    const bindings = bindingRows.map(row => {
      const storeCode = clean(row["FSTOCK.FNumber"]); const promoterCode = clean(row["FSR.FNumber"]);
      const emp = employeeMap.get(promoterCode.toUpperCase()) || {};
      const roleCode = clean(emp["F_RTA_Role.FNumber"]).toUpperCase();
      return { bindingKey: `${storeCode}\u0000${promoterCode}\u0000${clean(row.F_RTA_MainStore)}`, storeCode, promoterCode, promoterName: clean(emp.FName) || clean(row["FSR.FName"]), roleCode, roleName: ROLE_NAMES[roleCode] || "", mainStore: clean(row.F_RTA_MainStore), inactivePsNhtFl: employeeInactive(emp), raw: row };
    }).filter(r => r.storeCode && r.promoterCode && ALLOWED_ROLES.has(r.roleCode));

    const customerFields = CUSTOMER_FIELDS;
    const storeFields = STORE_FIELDS;
    const departmentFields = DEPARTMENT_FIELDS;
    const bindingCompareFields = [...BINDING_FIELDS, "promoterName", "roleCode", "roleName", "mainStore", "inactivePsNhtFl"];
    const bindingFieldValue = (row, f) => ["promoterName", "roleCode", "roleName", "mainStore", "inactivePsNhtFl"].includes(f) ? row?.[f] : row?.raw?.[f];
    const report = [
      compareFields("Customers", customers.filter(r => clean(r.FNumber)), loadLocal("kingdee_customers", "customer_code"), r => clean(r.FNumber), customerFields),
      compareFields("Stores", stores.filter(r => clean(r.FNumber)), loadLocal("kingdee_stores", "store_code"), r => clean(r.FNumber), storeFields),
      compareFields("Departments", departments.filter(r => clean(r.FNumber) || clean(r.FName)), loadLocal("kingdee_departments", "department_key"), r => clean(r.FNumber) || clean(r.FName), departmentFields),
      compareFields("Bindings", bindings, loadLocal("kingdee_bindings", "binding_key").map(row => ({ ...row, key: String(row.payload.bindingKey ?? `${row.payload.storeCode}\u0000${row.payload.promoterCode}\u0000${row.payload.mainStore}`) })), r => r.bindingKey, bindingCompareFields, x => x, x => x, bindingFieldValue)
    ];
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), organization: scope.organization, liveRawCounts: { customers: customers.length, stores: stores.length, departments: departments.length, bindings: bindingRows.length, employeeLookups: employeeMap.size, bindingsAfterExistingRoleFilter: bindings.length }, comparison: report }, null, 2));
  } finally {
    db.close();
  }
}

main().catch(error => {
  console.error("Comparison failed; no SQLite data was modified.");
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
