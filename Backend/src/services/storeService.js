import { STORE_FIELDS } from "../kingdee/fieldMaps.js";

const ASSISTANT_PS_NAMES = {
  DE: "Closed",
  FLG: "Frontliner Gcash",
  FLNG: "Frontliner NoGcash",
  PS: "Promoter",
};

const MAIN_LINE_NAMES = {
  MPA: "Mobile Phone and Accessories",
  MPO: "Mobile Phone Only",
  AO: "Accessories Only",
};

const clean = (value) => String(value ?? "").trim();

export function createStoreService({ kingdeeClient, scope, departmentService, masterDataService }) {
  async function mapAll() {
    const [storeRows, customerRows] = await Promise.all([
      masterDataService.getStores(),
      masterDataService.getCustomers(),
    ]);

    const departmentKeys = [...new Set(storeRows.flatMap((row) => [
      clean(row["F_RTA_Department.FNumber"]),
      clean(row["F_RTA_Department.FName"]),
      clean(row["F_RTA_Region.FNumber"]),
      clean(row["F_RTA_Region.FName"]),
    ]).filter(Boolean))];
    const territoryLookup = await departmentService.getTerritoryLookup(departmentKeys);
    const customerShortNames = new Map(
      customerRows.map((row) => [clean(row.FNumber), clean(row.FShortName)])
    );

    return storeRows.map((row) => {
      const assistantPSCode = clean(row["F_RTA_AssistantPSFL.FNumber"]);
      const departmentCode = clean(row["F_RTA_Department.FNumber"]);
      const regionCode = clean(row["F_RTA_Region.FNumber"]);
      const departmentInfo = territoryLookup[departmentCode] || territoryLookup[clean(row["F_RTA_Department.FName"])]
        || territoryLookup[regionCode] || territoryLookup[clean(row["F_RTA_Region.FName"])] || {};
      return {
        storeCode: clean(row.FNumber),
        storeName: clean(row.FName),
        mallName: clean(row.F_RTA_MallName),
        address: clean(row.FAddress),
        storeGroup: clean(row["FGroup.FName"]),
        storeGroupCode: clean(row["FGroup.FNumber"]),
        department: clean(row["F_RTA_Department.FName"]),
        departmentCode,
        territory: clean(departmentInfo.territoryName),
        territoryCode: clean(departmentInfo.territoryCode),
        region: clean(row["F_RTA_Region.FName"]),
        regionCode,
        brand: clean(row["F_RTA_Brand.FNumber"]),
        marketingChannel: clean(row["F_RTA_MarketingChannel.FName"]),
        marketingChannelCode: clean(row["F_RTA_MarketingChannel.FNumber"]),
        stockType: clean(row.FStockType),
        mainLine: MAIN_LINE_NAMES[clean(row.F_RTA_MainLine)] || clean(row.F_RTA_MainLine),
        assistantPS: ASSISTANT_PS_NAMES[assistantPSCode] || "",
        assistantPSCode,
        customerCode: clean(row["FCustomerId.FNumber"]),
        customerName: clean(row["FCustomerId.FName"]),
        customerShortName: customerShortNames.get(clean(row["FCustomerId.FNumber"])) || "",
        disabled: clean(row.FForbidStatus).toUpperCase() !== "A",
      };
    }).filter((store) => store.storeCode && !clean(store.storeName).toUpperCase().includes("TEST"));
  }

  const equalsAny = (value, codes = [], names = []) => {
    const v = clean(value).toUpperCase();
    if (!v) return false;
    return [...codes, ...names].some((candidate) => v === clean(candidate).toUpperCase());
  };

  async function getAllStores({ access } = {}) {
    const stores = await mapAll();
    const level = String(access?.accessLevel || "").toUpperCase();

    if (!access || level === "HQ" || level === "ADMIN") return stores;

    if (level === "CUSTOMER") {
      const allowedCustomerCodes = new Set(
        (access.customerCodes || []).map((code) => clean(code).toUpperCase()).filter(Boolean)
      );
      if (!allowedCustomerCodes.size) return [];
      return stores.filter((store) => allowedCustomerCodes.has(clean(store.customerCode).toUpperCase()));
    }

    const scopeMatches = access.scopeMatches || {};
    return stores.filter((store) =>
      equalsAny(store.territoryCode, scopeMatches.districtCodes, scopeMatches.districtNames) ||
      equalsAny(store.territory, scopeMatches.districtCodes, scopeMatches.districtNames) ||
      equalsAny(store.regionCode, scopeMatches.regionCodes, scopeMatches.regionNames) ||
      equalsAny(store.region, scopeMatches.regionCodes, scopeMatches.regionNames) ||
      equalsAny(store.departmentCode, scopeMatches.subRegionCodes, scopeMatches.subRegionNames) ||
      equalsAny(store.department, scopeMatches.subRegionCodes, scopeMatches.subRegionNames)
    );
  }

  return {
    getAllStores,

    async getStores({ search = "", startRow = 0, limit = 500, access } = {}) {
      let stores = await getAllStores({ access });
      const q = clean(search).toUpperCase();
      if (q) {
        stores = stores.filter((store) =>
          clean(store.storeCode).toUpperCase().includes(q) ||
          clean(store.storeName).toUpperCase().includes(q) ||
          clean(store.customerCode).toUpperCase().includes(q) ||
          clean(store.customerName).toUpperCase().includes(q) ||
          clean(store.customerShortName).toUpperCase().includes(q) ||
          clean(store.department).toUpperCase().includes(q) ||
          clean(store.region).toUpperCase().includes(q) ||
          clean(store.territory).toUpperCase().includes(q) ||
          clean(store.address).toUpperCase().includes(q)
        );
      }
      return stores.slice(startRow, startRow + limit);
    },
  };
}
