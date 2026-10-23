import { CUSTOMER_FIELDS } from "../kingdee/fieldMaps.js";
import { escapeKingdeeValue } from "../utils/kingdee.js";

const sameCustomerScope = (a, b) =>
  String(a ?? "").trim().toUpperCase() !== "" &&
  String(a ?? "").trim().toUpperCase() === String(b ?? "").trim().toUpperCase();

const clean = (value) => String(value ?? "").trim();

function isExcludedCustomer(customer) {
  const group = clean(customer.customerGroup).toUpperCase();
  const name = clean(customer.customerName).toUpperCase();
  const code = clean(customer.customerCode).toUpperCase();
  const salesDept = clean(customer.salesDept).toUpperCase();
  return (
    ["EMPLOYEE", "EMPLOYEES", "OTHERS", "REALME PH", "SERVICE CENTER", "AGENCY", "E-COMMERCE"].includes(group) ||
    ["AFTERSALES", "HQ.ECOM", "HQ.AFTER SALES", "HQ.MARKETING", "HQ.HR", "HQ.SALES"].includes(salesDept) ||
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

function filterSearch(items, search) {
  const q = clean(search).toUpperCase();
  if (!q) return items;
  return items.filter((item) =>
    clean(item.customerCode).toUpperCase().includes(q) ||
    clean(item.customerName).toUpperCase().includes(q)
  );
}

export function createCustomerService({ kingdeeClient, scope, departmentService, masterDataService }) {
  async function mapAll() {
    const raw = await masterDataService.getCustomers();
    // Customer hierarchy remains strictly Customer Region -> Customer District.
    // Resolve District from Customer Region first. If the Region has no
    // Territory mapping, use the Customer Sales Department only as a fallback
    // mapping source. Sales Department is never exposed as a hierarchy level.
    // Department Master lookup includes disabled departments because active
    // Customers may still reference a disabled Department Master.
    const regionKeys = [...new Set(raw.flatMap((row) => [
      clean(row["F_RTA_Region.FNumber"]),
      clean(row["F_RTA_Region.FName"]),
    ]).filter(Boolean))];
    const salesDeptKeys = [...new Set(raw.flatMap((row) => [
      clean(row["FSALDEPTID.FNumber"]),
      clean(row["FSALDEPTID.FName"]),
    ]).filter(Boolean))];
    const [territoryLookup, salesDeptLookup] = await Promise.all([
      departmentService.getTerritoryLookup(regionKeys),
      departmentService.getTerritoryLookup(salesDeptKeys),
    ]);

    return raw.map((row) => {
      const regionCode = clean(row["F_RTA_Region.FNumber"]);
      const regionName = clean(row["F_RTA_Region.FName"]);
      const salesDeptCode = clean(row["FSALDEPTID.FNumber"]);
      const salesDeptName = clean(row["FSALDEPTID.FName"]);
      const district = territoryLookup[regionCode] || territoryLookup[regionName]
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
        region: clean(row["F_RTA_Region.FName"]),
        regionCode,
        district: clean(district.territoryName),
        districtCode: clean(district.territoryCode),
        disabled: clean(row.FForbidStatus).toUpperCase() !== "A",
      };
    }).filter((customer) => customer.customerCode && !isExcludedCustomer(customer));
  }

  return {
    async getAllCustomers({ search = "", access } = {}) {
      const customers = filterSearch(await mapAll(), search);

      if (access && String(access.accessLevel || "").toUpperCase() === "SUB_REGION") {
        const error = new Error("Customer List access is not available for AREA-level roles.");
        error.status = 403;
        error.statusCode = 403;
        throw error;
      }

      if (!access || ["HQ", "ADMIN"].includes(String(access.accessLevel || "").toUpperCase())) {
        return customers;
      }

      if (String(access.accessLevel || "").toUpperCase() === "CUSTOMER") {
        if (String(access.customerScopeSource || "").toUpperCase() === "STORE_AREA") {
          const allowedCodes = new Set((access.customerCodes || []).map((code) => clean(code).toUpperCase()).filter(Boolean));
          return customers.filter((customer) => allowedCodes.has(clean(customer.customerCode).toUpperCase()));
        }
        const equal = (value) => sameCustomerScope(value, access.customerDepartment);
        return customers.filter((customer) =>
          equal(customer.salesDeptCode) || equal(customer.salesDept) ||
          equal(customer.regionCode) || equal(customer.region) ||
          equal(customer.districtCode) || equal(customer.district)
        );
      }

      const scopeMatches = access.scopeMatches || {};
      const equalsAny = (value, codes = [], names = []) => {
        const v = clean(value).toUpperCase();
        return [...codes, ...names].some((x) => clean(x).toUpperCase() === v);
      };
      return customers.filter((customer) =>
        equalsAny(customer.district, scopeMatches.districtCodes, scopeMatches.districtNames) ||
        equalsAny(customer.region, scopeMatches.regionCodes, scopeMatches.regionNames) ||
        equalsAny(customer.salesDept, scopeMatches.subRegionCodes, scopeMatches.subRegionNames)
      );
    },

    async getCustomers({ search = "", startRow = 0, limit = 500, access } = {}) {
      const data = await this.getAllCustomers({ search, access });
      if (String(access?.accessLevel || "").toUpperCase() === "HQ" || String(access?.accessLevel || "").toUpperCase() === "ADMIN") {
        return data;
      }
      return data.slice(startRow, startRow + limit);
    },
  };
}
