import { rowsToObjects, escapeKingdeeValue } from "../utils/kingdee.js";

// Binding module: RTA_StoreSR_Binding
// Store and promoter are Kingdee reference fields. Always use their .FNumber
// values so Store Codes/Employee Nos remain text references (e.g. STR.000056).
const BINDING_FIELDS = [
  "FSTOCK.FNumber",
  "FSR.FNumber",
  "FSR.FName",
  "F_RTA_MainStore",
];
const EMPLOYEE_FIELDS = [
  "FStaffNumber",
  "FName",
  "F_RTA_Role.FName",
  "F_RTA_Role.FNumber",
  "FForbidStatus",
  "F_RTA_ResignDate",
];
const clean = (v) => String(v ?? "").trim();

const PAGE_SIZE = 1000;
const FILTER_BATCH_SIZE = 50;
const EMPLOYEE_BATCH_CONCURRENCY = 5;
const employeeCache = new Map();

async function queryAll(kingdeeClient, formId, fieldKeys, filterString = "", orderString = "FNumber ASC") {
  const all = [];
  let startRow = 0;
  while (true) {
    const rows = await kingdeeClient.executeBillQuery({
      formId,
      fieldKeys,
      filterString,
      orderString,
      startRow,
      limit: PAGE_SIZE,
    });
    all.push(...rowsToObjects(rows, fieldKeys));
    if (rows.length < PAGE_SIZE) break;
    startRow += PAGE_SIZE;
  }
  return all;
}

async function queryByCodes(kingdeeClient, formId, fieldKeys, fieldName, codes, orderString) {
  const uniqueCodes = [...new Set(codes.map(clean).filter(Boolean))];
  if (!uniqueCodes.length) return [];

  const all = [];
  for (let i = 0; i < uniqueCodes.length; i += FILTER_BATCH_SIZE) {
    const batch = uniqueCodes.slice(i, i + FILTER_BATCH_SIZE);
    const filter = batch
      .map((code) => `${fieldName} = '${escapeKingdeeValue(code)}'`)
      .join(" OR ");
    all.push(
      ...(await queryAll(
        kingdeeClient,
        formId,
        fieldKeys,
        `(${filter})`,
        orderString
      ))
    );
  }
  return all;
}

async function loadAccessibleStores(storeService, access) {
  const level = String(access?.accessLevel || "").toUpperCase();

  // HQ/ADMIN: all stores (existing behavior).
  if (level === "HQ" || level === "ADMIN") {
    const all = [];
    let startRow = 0;
    while (true) {
      const page = await storeService.getStores({ startRow, limit: PAGE_SIZE });
      all.push(...page);
      if (page.length < PAGE_SIZE) break;
      startRow += PAGE_SIZE;
    }
    return all;
  }

  // KAM is Customer-level. Keep the established KAM rule: only stores
  // associated with the accessible Customer codes are authorized.
  if (level === "CUSTOMER") {
    const customerStoreCodes = new Set(
      (access.customerStoreCodes || [])
        .map((code) => clean(code).toUpperCase())
        .filter(Boolean)
    );
    const customerCodes = new Set(
      (access.customerCodes || [])
        .map((code) => clean(code).toUpperCase())
        .filter(Boolean)
    );
    if (!customerStoreCodes.size && !customerCodes.size) return [];

    const all = [];
    let startRow = 0;
    while (true) {
      const page = await storeService.getStores({ startRow, limit: PAGE_SIZE });
      all.push(...page);
      if (page.length < PAGE_SIZE) break;
      startRow += PAGE_SIZE;
    }
    if (customerStoreCodes.size) {
      return all.filter((store) => customerStoreCodes.has(clean(store.storeCode).toUpperCase()));
    }
    return all.filter((store) => customerCodes.has(clean(store.customerCode).toUpperCase()));
  }

  // IMPORTANT: Binding List must use the SAME exact organizational scope as
  // Store List. Do not call getStores({access}) here because Store List and
  // Binding List then risk using different hierarchy filters (for example,
  // a District user could be widened to its Region). Instead, load the full
  // Store master and apply access.scopeMatches exactly:
  //   District == Department OR Region == Department OR Sub-region == Department
  // with exact equality only and no parent/child expansion.
  const scope = access?.scopeMatches || {};
  const equalsAny = (value, codes = [], names = []) => {
    const v = clean(value).toUpperCase();
    if (!v) return false;
    return [...codes, ...names].some((candidate) =>
      v === clean(candidate).toUpperCase()
    );
  };

  const all = [];
  let startRow = 0;
  while (true) {
    const page = await storeService.getStores({ startRow, limit: PAGE_SIZE });
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    startRow += PAGE_SIZE;
  }

  const unique = new Map();
  for (const store of all) {
    const code = clean(store.storeCode).toUpperCase();
    if (!code || unique.has(code)) continue;

    const authorized =
      equalsAny(store.district, scope.districtCodes, scope.districtNames) ||
      equalsAny(store.territory, scope.districtCodes, scope.districtNames) ||
      equalsAny(store.region, scope.regionCodes, scope.regionNames) ||
      equalsAny(store.subRegion, scope.subRegionCodes, scope.subRegionNames) ||
      equalsAny(store.department, scope.subRegionCodes, scope.subRegionNames);

    if (authorized) unique.set(code, store);
  }

  return [...unique.values()];
}

async function employeeLookup(kingdeeClient, employeeCodes) {
  const uniqueCodes = [...new Set(employeeCodes.map(clean).filter(Boolean))];
  const map = new Map();
  const missing = [];

  for (const code of uniqueCodes) {
    const key = code.toUpperCase();
    const cached = employeeCache.get(key);
    if (cached) map.set(key, cached);
    else missing.push(code);
  }

  async function loadBatch(batch) {
    const rows = await queryByCodes(
      kingdeeClient,
      "BD_Empinfo",
      EMPLOYEE_FIELDS,
      "FStaffNumber",
      batch,
      "FStaffNumber ASC"
    );
    const found = new Map();
    for (const r of rows) {
      const code = clean(r.FStaffNumber).toUpperCase();
      if (!code) continue;
      const employee = {
        name: clean(r.FName),
        role: clean(r["F_RTA_Role.FName"]),
        roleCode: clean(r["F_RTA_Role.FNumber"]),
        forbidStatus: clean(r.FForbidStatus),
        resignDate: clean(r.F_RTA_ResignDate),
      };
      found.set(code, employee);
      employeeCache.set(code, employee);
    }
    for (const code of batch) {
      const key = clean(code).toUpperCase();
      if (!map.has(key)) map.set(key, found.get(key) || {
        name: "", role: "", roleCode: "", forbidStatus: "", resignDate: ""
      });
    }
  }

  const batches = [];
  for (let i = 0; i < missing.length; i += FILTER_BATCH_SIZE) {
    batches.push(missing.slice(i, i + FILTER_BATCH_SIZE));
  }
  for (let i = 0; i < batches.length; i += EMPLOYEE_BATCH_CONCURRENCY) {
    await Promise.all(batches.slice(i, i + EMPLOYEE_BATCH_CONCURRENCY).map(loadBatch));
  }

  return map;
}


const BINDING_ROLE_NAMES = {
  SP: "Promoter",
  NHT: "New Hire Trainee",
  FL: "Frontliner",
};

const ALLOWED_BINDING_ROLE_CODES = new Set(Object.keys(BINDING_ROLE_NAMES));

function employeeStatus(employee) {
  // TRUE when the employee is disabled/inactive, or when a resignation
  // date has already passed. A resignation date that is today or in the
  // future does not make the employee inactive yet.
  const forbidStatus = clean(employee?.forbidStatus).toUpperCase();
  if (forbidStatus && forbidStatus !== "A") return true;

  const resignDateText = clean(employee?.resignDate);
  if (!resignDateText) return false;

  const resignDate = new Date(resignDateText);
  if (Number.isNaN(resignDate.getTime())) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  resignDate.setHours(0, 0, 0, 0);

  return resignDate < today;
}

function roleName(employee) {
  const code = clean(employee?.roleCode).toUpperCase();
  return BINDING_ROLE_NAMES[code] || "";
}

export function createBindingService({ storeService, bindingRepository }) {
  return {
    async getBindings({ access, authorizedStores } = {}) {
      const stores = Array.isArray(authorizedStores) ? authorizedStores : await loadAccessibleStores(storeService, access);
      const storeLookup = new Map(stores.map((s) => [clean(s.storeCode).toUpperCase(), s]));
      const authorizedStoreCodes = new Set(storeLookup.keys());
      if (!authorizedStoreCodes.size) return [];

      return bindingRepository.getAllBindings()
        .filter((row) => authorizedStoreCodes.has(clean(row.storeCode).toUpperCase()))
        .map((row) => {
          const store = storeLookup.get(clean(row.storeCode).toUpperCase()) || {};
          return {
            storeCode: clean(row.storeCode),
            storeName: clean(store.storeName || row.storeName),
            subRegion: clean(store.subRegion || store.department || row.subRegion),
            region: clean(store.region || row.region),
            district: clean(store.district || store.territory || row.district),
            promoterCode: clean(row.promoterCode),
            promoterName: clean(row.promoterName),
            role: clean(row.roleName),
            inactivePsNhtFl: Boolean(row.inactivePsNhtFl),
            mainStore: clean(row.mainStore),
          };
        });
    },
  };
}
