import { CUSTOMER_FIELDS, STORE_FIELDS } from "../kingdee/fieldMaps.js";
import { buildOrganizationFilter, buildStoreFilter, rowsToObjects, escapeKingdeeValue } from "../utils/kingdee.js";

const EXCLUDED_CUSTOMER_GROUPS = new Set([
  "EMPLOYEE",
  "EMPLOYEES",
  "OTHERS",
  "REALME PH",
  "SERVICE CENTER",
  "AGENCY",
  "E-COMMERCE",
]);
const EXCLUDED_SALES_DEPTS = new Set([
  "AFTERSALES",
  "HQ.ECOM",
  "HQ.AFTER SALES",
  "HQ.MARKETING",
  "HQ.HR",
  "HQ.SALES",
]);
const ASSISTANT_PS_NAMES = {
  DE: "Closed",
  FLG: "Frontliner Gcash",
  FLNG: "Frontliner NoGcash",
  PS: "Promoter",
};

// F_RTA_MainLine is a Kingdee dropdown/enum field. The Store master stores
// the code/value (currently MPA), while the form displays the corresponding
// business label. Keep the verified dropdown labels here rather than treating
// the field as a referenced master relation.
const MAIN_LINE_NAMES = {
  MPA: "Mobile Phone and Accessories",
  MPO: "Mobile Phone Only",
  AO: "Accessories Only",
};

const clean = (value) => String(value ?? "").trim();

function isTestStore(store) {
  return clean(store.storeName).toUpperCase().includes("TEST");
}

function isExcludedCustomer(customer) {
  const group = clean(customer.customerGroup).toUpperCase();
  const name = clean(customer.customerName).toUpperCase();
  const code = clean(customer.customerCode).toUpperCase();
  const salesDept = clean(customer.salesDept).toUpperCase();
  return (
    EXCLUDED_CUSTOMER_GROUPS.has(group) ||
    EXCLUDED_SALES_DEPTS.has(salesDept) ||
    name.includes("TEST") ||
    name.includes("TEMPORARY") ||
    name.includes("RUNTO") ||
    name.includes("SIKLAB") ||
    name.includes("EKSBASE") ||
    name.includes("GLOBAL TECHNOLOGICAL") ||
    name.includes("MALAYSIA") ||
    code.includes("TEST")
  );
}
const levelOf = (access) => clean(access?.accessLevel).toUpperCase();

function deny(message) {
  const error = new Error(message);
  error.status = 403;
  error.statusCode = 403;
  throw error;
}

function assertAccess(access) {
  const level = levelOf(access);
  if (level === "SUB_REGION") deny("Customer Store List access is not available for AREA-level roles.");
  if (!["HQ", "ADMIN", "DISTRICT", "REGION", "CUSTOMER"].includes(level)) {
    deny("Customer Store List access is not available for this access level.");
  }
}

async function queryAll(kingdeeClient, formId, fieldKeys, filterString) {
  const all = [];
  let startRow = 0;
  const pageSize = 1000;
  while (true) {
    const page = await kingdeeClient.executeBillQuery({
      formId,
      fieldKeys,
      filterString,
      orderString: "FNumber ASC",
      startRow,
      limit: pageSize,
    });
    all.push(...rowsToObjects(page, fieldKeys));
    if (page.length < pageSize) break;
    startRow += pageSize;
  }
  return all;
}

function scopedFilter(base, access) {
  const conditions = [base];
  const level = levelOf(access);
  if (!["HQ", "ADMIN", "CUSTOMER"].includes(level)) {
    const scope = access?.scopeMatches || {};
    const scopeConditions = [];
    for (const code of scope.regionCodes || []) {
      scopeConditions.push(`F_RTA_Region.FNumber = '${escapeKingdeeValue(code)}'`);
    }
    for (const name of scope.regionNames || []) {
      scopeConditions.push(`F_RTA_Region.FName = '${escapeKingdeeValue(name)}'`);
    }
    for (const code of scope.subRegionCodes || []) {
      scopeConditions.push(`FSALDEPTID.FNumber = '${escapeKingdeeValue(code)}'`);
    }
    for (const name of scope.subRegionNames || []) {
      scopeConditions.push(`FSALDEPTID.FName = '${escapeKingdeeValue(name)}'`);
    }
    if (scopeConditions.length) conditions.push(`(${scopeConditions.join(" OR ")})`);
  }
  return conditions.join(" AND ");
}

function mapCustomer(row, districtLookup, salesDeptLookup = {}) {
  const regionCode = clean(row["F_RTA_Region.FNumber"]);
  const regionName = clean(row["F_RTA_Region.FName"]);

  // Customer hierarchy remains Customer Region -> Customer District.
  // Resolve the District from Customer Region first. If the Region has no
  // Territory mapping, use the Customer Sales Department only as a fallback
  // mapping source. Sales Department is NOT exposed as a hierarchy level.
  // Department Master lookup intentionally includes disabled departments because
  // active Customer records may still reference a disabled Department Master.
  const salesDeptCode = clean(row["FSALDEPTID.FNumber"]);
  const salesDeptName = clean(row["FSALDEPTID.FName"]);
  const district = districtLookup[regionCode] || districtLookup[regionName]
    || salesDeptLookup[salesDeptCode] || salesDeptLookup[salesDeptName] || {};
  return {
    customerCode: clean(row.FNumber),
    customerName: clean(row.FName),
    customerShortName: clean(row.FShortName),
    customerType: clean(row["F_RTA_AssCustClass.FNumber"]) || clean(row.F_RTA_CustClass),
    customerGroup: clean(row["FGroup.FName"]),
    address: clean(row.FADDRESS),
    salesDept: clean(row["FSALDEPTID.FName"]),
    salesDeptCode: clean(row["FSALDEPTID.FNumber"]),
    region: regionName,
    regionCode,
    district: clean(district.territoryName),
    districtCode: clean(district.territoryCode),
    disabled: clean(row.FForbidStatus).toUpperCase() !== "A",
  };
}

function mapStore(row, territoryLookup, customerLookup) {
  const departmentCode = clean(row["F_RTA_Department.FNumber"]);
  const regionCode = clean(row["F_RTA_Region.FNumber"]);
  // Store District/Territory is resolved from the Store Department, matching the original working mapping.
  // Region is retained only as a fallback when no Department mapping exists.
  const departmentInfo = territoryLookup[departmentCode] || territoryLookup[clean(row["F_RTA_Department.FName"])]
    || territoryLookup[regionCode] || territoryLookup[clean(row["F_RTA_Region.FName"])] || {};
  const customerCode = clean(row["FCustomerId.FNumber"]);
  const customer = customerLookup.get(customerCode) || {};
  const assistantPSCode = clean(row["F_RTA_AssistantPSFL.FNumber"]);
  return {
    storeCode: clean(row.FNumber),
    storeName: clean(row.FName),
    mallOfStreetName: clean(row.F_RTA_MallName),
    address: clean(row.FAddress),
    group: clean(row["FGroup.FName"]),
    subRegion: clean(row["F_RTA_Department.FName"]),
    subRegionCode: departmentCode,
    region: clean(row["F_RTA_Region.FName"]),
    regionCode,
    district: clean(departmentInfo.territoryName),
    districtCode: clean(departmentInfo.territoryCode),
    brand: clean(row["F_RTA_Brand.FNumber"]),
    psOrFlStore: ASSISTANT_PS_NAMES[assistantPSCode] || "",
    marketingChannel: clean(row["F_RTA_MarketingChannel.FNumber"]),
    storeType: clean(row.FStockType),
    mainLineOfProducts: MAIN_LINE_NAMES[clean(row.F_RTA_MainLine)] || clean(row.F_RTA_MainLine),
    customerCode,
    customerName: clean(row["FCustomerId.FName"]),
    customerShortName: clean(customer.customerShortName),
    customerRegion: clean(customer.region),
    customerDistrict: clean(customer.district),
    customerDisabled: customer.customerCode ? Boolean(customer.disabled) : "",
    disabled: clean(row.FForbidStatus).toUpperCase() !== "A",
  };
}

function filterSearch(items, search, fields) {
  const q = clean(search).toUpperCase();
  if (!q) return items;
  return items.filter((item) => fields.some((field) => clean(item[field]).toUpperCase().includes(q)));
}

function sortBy(...fields) {
  return (a, b) => {
    for (const field of fields) {
      const av = clean(a[field]).toUpperCase();
      const bv = clean(b[field]).toUpperCase();
      const cmp = av.localeCompare(bv);
      if (cmp) return cmp;
    }
    return 0;
  };
}

function buildCustomerHierarchy(customers) {
  const districts = new Map();
  for (const customer of customers) {
    const districtKey = customer.districtCode || customer.district || "";
    const regionKey = customer.regionCode || customer.region || "";
    const key = `${districtKey}|${regionKey}`;
    if (!districts.has(key)) {
      districts.set(key, {
        district: customer.district,
        districtCode: customer.districtCode,
        region: customer.region,
        regionCode: customer.regionCode,
        customers: [],
      });
    }
    districts.get(key).customers.push(customer);
  }
  return [...districts.values()]
    .sort(sortBy("districtCode", "regionCode"))
    .map((group) => ({
      ...group,
      customers: group.customers.sort(sortBy("customerCode")),
    }));
}

function buildStoreHierarchy(stores) {
  const districts = new Map();
  for (const store of stores) {
    const districtKey = store.districtCode || store.district || "";
    const regionKey = store.regionCode || store.region || "";
    const subRegionKey = store.subRegionCode || store.subRegion || "";
    const dKey = districtKey;
    const rKey = `${districtKey}|${regionKey}`;
    const sKey = `${districtKey}|${regionKey}|${subRegionKey}`;
    if (!districts.has(dKey)) districts.set(dKey, { district: store.district, districtCode: store.districtCode, regions: new Map() });
    const district = districts.get(dKey);
    if (!district.regions.has(rKey)) district.regions.set(rKey, { region: store.region, regionCode: store.regionCode, subRegions: new Map() });
    const region = district.regions.get(rKey);
    if (!region.subRegions.has(sKey)) region.subRegions.set(sKey, { subRegion: store.subRegion, subRegionCode: store.subRegionCode, stores: [] });
    region.subRegions.get(sKey).stores.push(store);
  }
  return [...districts.values()]
    .sort(sortBy("districtCode"))
    .map((district) => ({
      ...district,
      regions: [...district.regions.values()].sort(sortBy("regionCode")).map((region) => ({
        ...region,
        subRegions: [...region.subRegions.values()].sort(sortBy("subRegionCode")).map((subRegion) => ({
          ...subRegion,
          stores: subRegion.stores.sort(sortBy("storeCode")),
        })),
      })),
    }));
}

function buildCustomerStoreRows(customers, stores) {
  const storesByCustomer = new Map();
  for (const store of stores) {
    if (!store.customerCode) continue;
    if (!storesByCustomer.has(store.customerCode)) storesByCustomer.set(store.customerCode, []);
    storesByCustomer.get(store.customerCode).push(store);
  }

  const rows = [];
  for (const customer of customers.sort(sortBy("districtCode", "regionCode", "customerCode"))) {
    const customerStores = (storesByCustomer.get(customer.customerCode) || []).sort(sortBy("storeCode"));
    if (!customerStores.length) {
      rows.push({
        ...customer,
        // This row represents a valid Customer with NO linked Store.
        // Keep all Store-side fields blank. Customer Region/District belong
        // only to the Customer fields above and must never be copied into
        // Store Region/District for a customer-only relationship row.
        storeCode: "",
        storeName: "",
        mallOfStreetName: "",
        address: "",
        group: "",
        subRegion: "",
        region: "",
        district: "",
        brand: "",
        psOrFlStore: "",
        marketingChannel: "",
        storeType: "",
        mainLineOfProducts: "",
        customerCode: customer.customerCode,
        customerName: customer.customerName,
        customerShortName: customer.customerShortName,
        customerRegion: customer.region,
        customerDistrict: customer.district,
        // This is a Customer-only row. The Customer status remains available
        // for the Inactive Customer column, while Store-specific status stays blank.
        customerDisabled: Boolean(customer.disabled),
        disabled: "",
      });
    } else {
      for (const store of customerStores) rows.push(store);
    }
  }
  return rows;
}

export function createCustomerStoreService({ kingdeeClient, scope, departmentService, masterDataService }) {
  async function load({ search = "", access, fresh = false }) {
    // Customer scope is applied after mapping. FSALDEPTID.* cannot be used
    // reliably in Kingdee WHERE clauses in this environment.
    const organizationFilter = buildOrganizationFilter(scope.organizationField, scope.organization);
    const customerFilter = organizationFilter;
    const storeFilter = buildStoreFilter(scope.organizationField, scope.organization);
    const customerStoreFilter = buildStoreFilter(scope.organizationField, scope.organization);

    // Raw Customer/Store masters are shared and cached for a short TTL.
    // This avoids repeating the same Kingdee pagination work across login,
    // summary, list, and export flows while preserving the existing filters.
    const [customerRaw, storeRaw] = await Promise.all([
      masterDataService.getCustomers({ fresh }),
      masterDataService.getStores({ fresh }),
    ]);

    // Customer hierarchy: Customer Region -> Customer District.
    // Store hierarchy is resolved independently from Store Region -> Store
    // District. Do not mix Store Region/Territory data into Customer mapping,
    // and do not use Sales Department as a Customer hierarchy fallback.
    const customerRegionKeys = [...new Set(customerRaw.flatMap((row) => [
      clean(row["F_RTA_Region.FNumber"]),
      clean(row["F_RTA_Region.FName"]),
    ]).filter(Boolean))];
    const storeRegionKeys = [...new Set(storeRaw.flatMap((row) => [
      clean(row["F_RTA_Region.FNumber"]),
      clean(row["F_RTA_Region.FName"]),
    ]).filter(Boolean))];
    // Some Store/Warehouse Region references (for example WNLU, NMNL, ZAM)
    // are organizational codes that do not have a direct BD_Department row.
    // Their F_RTA_Department reference does, however, map to the correct
    // Territory. Keep Department as enrichment and use the Store Department
    // only as the fallback source for the Store District.
    const storeDepartmentKeys = [...new Set(storeRaw.flatMap((row) => [
      clean(row["F_RTA_Department.FNumber"]),
      clean(row["F_RTA_Department.FName"]),
    ]).filter(Boolean))];
    const customerSalesDeptKeys = [...new Set(customerRaw.flatMap((row) => [
      clean(row["FSALDEPTID.FNumber"]),
      clean(row["FSALDEPTID.FName"]),
    ]).filter(Boolean))];

    const [customerDistrictLookup, territoryLookup, storeDepartmentLookup, customerSalesDeptLookup] = await Promise.all([
      departmentService.getTerritoryLookup(customerRegionKeys),
      departmentService.getTerritoryLookup(storeRegionKeys),
      departmentService.getTerritoryLookup(storeDepartmentKeys),
      departmentService.getTerritoryLookup(customerSalesDeptKeys),
    ]);

    const customerStoreStoreRaw = storeRaw;
    const storeCustomerRaw = customerRaw;
    const customerStoreTerritoryLookup = territoryLookup;
    const storeCustomerDistrictLookup = customerDistrictLookup;

    const allCustomers = customerRaw
      .map((row) => mapCustomer(row, customerDistrictLookup, customerSalesDeptLookup))
      .filter((customer) => customer.customerCode);

    // Store List access is controlled only by Store Sub-region/Region/District.
    // Its Customer Short Name enrichment must therefore be independent of the
    // Customer List access scope. Use the full organization Customer master for
    // the Store List lookup, without adding those customers to the Customer List.
    const storeCustomers = storeCustomerRaw
      .map((row) => mapCustomer(row, storeCustomerDistrictLookup, customerSalesDeptLookup))
      .filter((customer) => customer.customerCode);
    const storeCustomerLookup = new Map(
      storeCustomers.map((customer) => [customer.customerCode, customer])
    );

    // Keep excluded Customer records out of the Customer List, but retain
    // the full organization Customer lookup so Store List enrichment can still
    // show linked Customer Short Name values when applicable.
    const eligibleCustomers = allCustomers.filter((customer) => !isExcludedCustomer(customer));
    const customers = levelOf(access) === "CUSTOMER"
      ? (String(access?.customerScopeSource || "").toUpperCase() === "STORE_AREA"
          ? (() => {
              const allowedCodes = new Set((access?.customerCodes || []).map((code) => clean(code).toUpperCase()).filter(Boolean));
              return eligibleCustomers.filter((customer) => allowedCodes.has(clean(customer.customerCode).toUpperCase()));
            })()
          : eligibleCustomers.filter((customer) => {
              const dept = clean(access?.customerDepartment).toUpperCase();
              const equal = (value) => clean(value).toUpperCase() !== "" && clean(value).toUpperCase() === dept;
              return equal(customer.salesDeptCode) || equal(customer.salesDept)
                || equal(customer.regionCode) || equal(customer.region)
                || equal(customer.districtCode) || equal(customer.district);
            }))
      : (!access || ["HQ", "ADMIN"].includes(levelOf(access)))
        ? eligibleCustomers
        : eligibleCustomers.filter((customer) => {
            const scopeMatches = access?.scopeMatches || {};
            const equalsAny = (value, codes, names) => {
              const v = clean(value).toUpperCase();
              return [...(codes || []), ...(names || [])].some((x) => clean(x).toUpperCase() === v);
            };
            return equalsAny(customer.district, scopeMatches.districtCodes, scopeMatches.districtNames)
              || equalsAny(customer.region, scopeMatches.regionCodes, scopeMatches.regionNames)
              || equalsAny(customer.salesDept, scopeMatches.subRegionCodes, scopeMatches.subRegionNames);
          });

    // DSTDLR is a global export section. It is NOT restricted by the
    // logged-in user's District/Region/Sub-region scope. It must contain
    // customers whose Sales Dept is HQ.DSTDLR for every dashboard access level.
    // Apply the same business Customer exclusion rules used by Customer List.
    // The only exception is that HQ.DSTDLR itself is NOT an excluded Sales Dept.
    const dstDlrCustomers = storeCustomers
      .filter((customer) => {
        const salesDeptCode = clean(customer.salesDeptCode).toUpperCase();
        const salesDeptName = clean(customer.salesDept).toUpperCase();
        return (salesDeptCode === "HQ.DSTDLR" || salesDeptName === "HQ.DSTDLR")
          && !isExcludedCustomer(customer);
      })
      .sort(sortBy("districtCode", "regionCode", "customerCode"));

    const customerLookup = new Map(
      customers.map((customer) => [customer.customerCode, customer])
    );
    let stores = storeRaw
      .map((row) => mapStore(row, { ...territoryLookup, ...storeDepartmentLookup }, storeCustomerLookup))
      .filter((store) => store.storeCode && !isTestStore(store));

    if (levelOf(access) === "CUSTOMER") {
      if (String(access?.customerScopeSource || "").toUpperCase() === "STORE_AREA" && (access?.customerStoreCodes || []).length) {
        const allowedStoreCodes = new Set((access.customerStoreCodes || []).map((code) => clean(code).toUpperCase()).filter(Boolean));
        stores = stores.filter((store) => allowedStoreCodes.has(clean(store.storeCode).toUpperCase()));
      } else {
        const accessibleCodes = new Set(customers.map((customer) => clean(customer.customerCode)));
        stores = stores.filter((store) => accessibleCodes.has(clean(store.customerCode)));
      }
    } else if (access && !["HQ", "ADMIN"].includes(levelOf(access))) {
      const scopeMatches = access.scopeMatches || {};
      const equalsAny = (value, codes, names) => {
        const v = clean(value).toUpperCase();
        return [...(codes || []), ...(names || [])].some((x) => clean(x).toUpperCase() === v);
      };
      stores = stores.filter((store) =>
        equalsAny(store.district, scopeMatches.districtCodes, scopeMatches.districtNames)
        || equalsAny(store.region, scopeMatches.regionCodes, scopeMatches.regionNames)
        || equalsAny(store.subRegion, scopeMatches.subRegionCodes, scopeMatches.subRegionNames)
      );
    }

    // Customer Store List access is controlled ONLY by the Customer's
    // Region/District access. The linked Store's Sub-region/Region/District
    // must NOT affect inclusion here. Therefore load the full Store master
    // for the organization and retain only Stores linked to the already-accessible
    // Customer set. Store List access remains independently controlled by
    // storeFilter above.
    let customerStoreStoresAll = customerStoreStoreRaw
      .map((row) => mapStore(row, customerStoreTerritoryLookup, customerLookup))
      .filter((store) => store.storeCode && !isTestStore(store) && customerLookup.has(store.customerCode) && !isExcludedCustomer(customerLookup.get(store.customerCode)));

    if (levelOf(access) === "CUSTOMER" && String(access?.customerScopeSource || "").toUpperCase() === "STORE_AREA" && (access?.customerStoreCodes || []).length) {
      const allowedStoreCodes = new Set((access.customerStoreCodes || []).map((code) => clean(code).toUpperCase()).filter(Boolean));
      customerStoreStoresAll = customerStoreStoresAll.filter((store) => allowedStoreCodes.has(clean(store.storeCode).toUpperCase()));
    }

    const searchedCustomers = filterSearch(customers, search, ["customerCode", "customerName", "customerShortName", "customerGroup", "region", "district", "salesDept", "address"]);
    const searchedStores = filterSearch(stores, search, ["storeCode", "storeName", "customerCode", "customerName", "subRegion", "region", "district", "address"]);
    const searchedCustomerStoreStores = filterSearch(customerStoreStoresAll, search, ["storeCode", "storeName", "customerCode", "customerName", "subRegion", "region", "district", "address"]);

    return {
      customers: searchedCustomers.sort(sortBy("districtCode", "regionCode", "customerCode")),
      stores: searchedStores.sort(sortBy("districtCode", "regionCode", "subRegionCode", "storeCode")),
      customerStoreStores: searchedCustomerStoreStores.sort(sortBy("customerDistrict", "customerRegion", "customerCode", "storeCode")),
      dstDlrCustomers,
    };
  }

  return {
    async getCustomerStores({ search = "", startRow = 0, limit = 500, access, fresh = false } = {}) {
      assertAccess(access);
      const data = await load({ search, access, fresh });
      const customerHierarchy = buildCustomerHierarchy(data.customers);
      const storeHierarchy = buildStoreHierarchy(data.customerStoreStores);
      return {
        count: data.customers.length,
        customers: data.customers.slice(startRow, startRow + limit),
        customerHierarchy,
        storeHierarchy,
      };
    },

    async getAllCustomerStores({ search = "", access, fresh = false } = {}) {
      const data = await load({ search, access, fresh });
      const customerStoreRows = buildCustomerStoreRows(data.customers, data.customerStoreStores);
      return {
        customerRows: data.customers,
        storeRows: data.stores,
        // Full Customer->Store relationship set. This is intentionally kept
        // separate from Store-tab rows because Customer Store Count must count
        // active Stores under accessible Customers regardless of Store geography.
        customerStoreStores: data.customerStoreStores || [],
        customerStoreRows,
        dstDlrCustomers: data.dstDlrCustomers || [],
        customerHierarchy: buildCustomerHierarchy(data.customers),
        storeHierarchy: buildStoreHierarchy(data.stores),
      };
    },
  };
}
