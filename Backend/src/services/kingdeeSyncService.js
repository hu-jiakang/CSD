import { CUSTOMER_FIELDS, STORE_FIELDS, DEPARTMENT_FIELDS } from "../kingdee/fieldMaps.js";
import { buildOrganizationFilter, buildStoreFilter, rowsToObjects, escapeKingdeeValue } from "../utils/kingdee.js";
import { replaceMasterDataSnapshot, createSyncLog, completeSyncLog, failSyncLog, getKingdeeDataStats } from "../database/kingdeeDataRepository.js";

const PAGE_SIZE = 1000;
const FILTER_BATCH_SIZE = 50;
const EMPLOYEE_BATCH_CONCURRENCY = 5;
const BINDING_FIELDS = ["FSTOCK.FNumber", "FSR.FNumber", "FSR.FName", "F_RTA_MainStore"];
const EMPLOYEE_FIELDS = ["FStaffNumber", "FName", "F_RTA_Role.FName", "F_RTA_Role.FNumber", "FForbidStatus", "F_RTA_ResignDate"];
const ROLE_NAMES = { SP: "Promoter", NHT: "New Hire Trainee", FL: "Frontliner" };
const ALLOWED_ROLES = new Set(Object.keys(ROLE_NAMES));
const clean = (value) => String(value ?? "").trim();

export function createKingdeeSyncService({ kingdeeClient, scope }) {
  let running = null;

  async function queryAll(formId, fieldKeys, filterString, orderString = "FNumber ASC") {
    const all = []; let startRow = 0;
    while (true) {
      const rows = await kingdeeClient.executeBillQuery({ formId, fieldKeys, filterString, orderString, startRow, limit: PAGE_SIZE });
      all.push(...rowsToObjects(rows, fieldKeys));
      if (rows.length < PAGE_SIZE) break;
      startRow += PAGE_SIZE;
    }
    return all;
  }

  async function queryEmployees(codes) {
    const unique = [...new Set(codes.map(clean).filter(Boolean))]; const result = new Map();
    for (let i=0;i<unique.length;i+=FILTER_BATCH_SIZE) {
      const batch=unique.slice(i,i+FILTER_BATCH_SIZE);
      const employeeFilter = batch.map(c => `FStaffNumber = '${escapeKingdeeValue(c)}'`).join(" OR ");
      const organizationFilter = buildOrganizationFilter(scope.organizationField, scope.organization);
      const filter = `(${organizationFilter}) AND (${employeeFilter})`;
      const rows = await queryAll("BD_Empinfo", EMPLOYEE_FIELDS, filter, "FStaffNumber ASC");
      for(const row of rows){ const code=clean(row.FStaffNumber).toUpperCase(); if(code) result.set(code,row); }
    }
    return result;
  }

  function employeeInactive(row) {
    if (clean(row?.FForbidStatus).toUpperCase() && clean(row.FForbidStatus).toUpperCase() !== "A") return true;
    const d=clean(row?.F_RTA_ResignDate); if(!d) return false; const date=new Date(d); if(Number.isNaN(date.getTime())) return false;
    const today=new Date(); today.setHours(0,0,0,0); date.setHours(0,0,0,0); return date<today;
  }

  async function sync() {
    if (running) return { ...await running, alreadyRunning: true };
    running = (async()=>{
      const syncId=createSyncLog("master_data");
      try {
        // Fetch every source dataset before touching SQLite. Binding data is scoped
        // to the configured Kingdee organization, just like customer/store data.
        const organizationFilter = buildOrganizationFilter(scope.organizationField, scope.organization);
        const customerRows = await queryAll("BD_Customer", CUSTOMER_FIELDS, organizationFilter);
        const storeRows = await queryAll("BD_STOCK", STORE_FIELDS, buildStoreFilter(scope.organizationField, scope.organization));
        const bindingRows = await queryAll(
          "RTA_StoreSR_Binding",
          BINDING_FIELDS,
          buildOrganizationFilter("F_RTA_UseOrgId.FNumber", scope.organization),
          "FSTOCK.FNumber ASC,FSR.FNumber ASC"
        );
        const departmentRows = await queryAll("BD_Department", DEPARTMENT_FIELDS, organizationFilter, "FNumber ASC");

        // Never replace a valid local snapshot with an empty/invalid source result.
        const validCustomers=customerRows.filter(row=>clean(row?.FNumber));
        const validStores=storeRows.filter(row=>clean(row?.FNumber));
        const validDepartments=departmentRows.filter(row=>clean(row?.FNumber)||clean(row?.FName));
        if (!validCustomers.length) throw new Error("Kingdee Customer query returned no usable records; existing local snapshot was preserved.");
        if (!validStores.length) throw new Error("Kingdee Store query returned no usable records; existing local snapshot was preserved.");
        if (!validDepartments.length) throw new Error("Kingdee Department query returned no usable records; existing local snapshot was preserved.");
        if (!bindingRows.length) throw new Error("Kingdee Binding query returned no records for the configured organization; existing local snapshot was preserved.");

        const employeeMap=await queryEmployees(bindingRows.map(r=>r["FSR.FNumber"]));
        const bindings=bindingRows.map(row=>{
          const storeCode=clean(row["FSTOCK.FNumber"]), promoterCode=clean(row["FSR.FNumber"]);
          const emp=employeeMap.get(promoterCode.toUpperCase())||{}; const roleCode=clean(emp["F_RTA_Role.FNumber"]).toUpperCase();
          return { bindingKey:`${storeCode}\u0000${promoterCode}\u0000${clean(row.F_RTA_MainStore)}`,storeCode,promoterCode,promoterName:clean(emp.FName)||clean(row["FSR.FName"]),roleCode,roleName:ROLE_NAMES[roleCode]||"",mainStore:clean(row.F_RTA_MainStore),inactivePsNhtFl:employeeInactive(emp),raw:row };
        }).filter(r=>r.storeCode&&r.promoterCode&&ALLOWED_ROLES.has(r.roleCode));

        // Commit the refreshed master data as one SQLite transaction. Stale rows
        // are removed; a failed write rolls back all four datasets together.
        const saved=replaceMasterDataSnapshot({
          customers:validCustomers,
          stores:validStores,
          departments:validDepartments,
          bindings
        });
        const fetched=customerRows.length+storeRows.length+bindingRows.length+departmentRows.length+employeeMap.size;
        completeSyncLog(syncId,fetched,saved);
        return { stats:getKingdeeDataStats(), fetched, saved, completedAt:new Date().toISOString(), alreadyRunning:false };
      } catch(error){ failSyncLog(syncId,error); throw error; }
    })();
    try{return await running;} finally{running=null;}
  }

  return { syncCustomersAndStores: sync, sync: sync, getStats:getKingdeeDataStats, isRunning:()=>Boolean(running) };
}
