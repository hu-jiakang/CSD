const ALLOWED_ROLE_CODES = new Set([
  "ADMIN",
  "ASM",
  "CSH",
  "DRH",
  "KAM",
  "LA",
  "RAM",
  "RRM",
  "RSD",
  "RSH",
  "RTM",
  "SLA",
  "SS",
]);

const ROLE_NAMES = {
  ADMIN: "HQ Admin",
  ASM: "Area Sales Manager",
  CSH: "Channel Sales Head",
  DRH: "District Retail Head",
  KAM: "Key Account Manager",
  LA: "Large Area",
  RAM: "Regional Account Manager",
  RRM: "Regional Retail Manager",
  RSD: "Regional Sales Director",
  RSH: "Regional Sales Head",
  RTM: "Regional Training Manager",
  SLA: "SLA",
  SS: "Area Sales Lead",
};

/*
 * Role controls the organizational ACCESS LEVEL.
 *
 * Business mapping:
 *   ADMIN              -> HQ
 *   RSD, LA, DRH       -> DISTRICT
 *   RAM, RRM, RTM, RSH -> REGION
 *   CSH                 -> HQ
 *   KAM                 -> CUSTOMER
 *   SLA, SS, ASM        -> AREA
 *
 * AREA is represented internally as SUB_REGION because the existing
 * customer/store services use SUB_REGION as the data-filter level.
 */
const ROLE_ACCESS_LEVELS = {
  ADMIN: "HQ",

  RSD: "DISTRICT",
  LA: "DISTRICT",
  DRH: "DISTRICT",

  RAM: "REGION",
  RRM: "REGION",
  RTM: "REGION",
  RSH: "REGION",

  CSH: "HQ",
  KAM: "CUSTOMER",
  SLA: "SUB_REGION",
  SS: "SUB_REGION",
  ASM: "SUB_REGION",
};

const clean = (value) => String(value ?? "").trim();

function norm(value) {
  const x = clean(value).toUpperCase();
  return x === "SUB-REGION" || x === "SUB REGION" ? "SUB_REGION" : x;
}

function same(a, b) {
  return norm(a) !== "" && norm(a) === norm(b);
}

export function getAllowedRoles() {
  return [...ALLOWED_ROLE_CODES].map((code) => ({
    code,
    name: ROLE_NAMES[code],
  }));
}

/**
 * Resolve dashboard access.
 *
 * Authorization is intentionally split into two decisions:
 *
 * 1. ROLE AUTHORIZATION
 *    F_RTA_Role.FNumber decides whether the employee may access the
 *    Customer & Store Dashboard. Roles outside ALLOWED_ROLE_CODES,
 *    including SP (Promoter), are rejected before a session is created.
 *
 * 2. DATA SCOPE
 *    The ROLE determines the required organizational level, while the
 *    employee Department identifies the employee's specific organization
 *    within that level.
 *
 * This prevents department-name collisions such as CLU District vs.
 * CLU Region from being resolved by an arbitrary hierarchy match.
 */
export function createAccessService({ storeService, customerService }) {
  return {
    async resolve(employee) {
      const roleCode = clean(employee.roleCode).toUpperCase();
      const roleName = ROLE_NAMES[roleCode] || clean(employee.role);

      // ROLE GATE ONLY.
      // SP (Promoter) and every other unlisted role are unauthorized.
      if (!ALLOWED_ROLE_CODES.has(roleCode)) {
        return {
          allowed: false,
          roleCode,
          role: roleName,
          reason: `Role '${roleCode || "UNASSIGNED"}' is not authorized to access Customer & Store Dashboard.`,
        };
      }

      const requiredAccessLevel = ROLE_ACCESS_LEVELS[roleCode];

      // Defensive check: every allowed role must have an explicit scope.
      if (!requiredAccessLevel) {
        return {
          allowed: false,
          roleCode,
          role: roleName,
          reason: `No dashboard access level is configured for role '${roleCode}'.`,
        };
      }

      const departmentCode = clean(employee.departmentCode);
      const departmentName = clean(employee.department);
      const department = norm(departmentName || departmentCode);

      // ADMIN and CSH are both HQ-level roles and must have identical
      // authorization behavior. Employee Department must NOT restrict HQ
      // access for either role. Keep this before all department-scoping
      // logic so ADMIN/CSH cannot be rejected by their department value.
      if (roleCode === "ADMIN" || roleCode === "CSH") {
        return {
          allowed: true,
          accessLevel: "HQ",
          roleCode,
          role: roleName,
          district: "",
          region: "",
          subRegion: "",
          warehouseCode: "",
        };
      }

      // KAM uses Customer Level access. Resolve the employee Department
      // against Customer Sales Dept OR Customer Region OR Customer District
      // using exact equality. This is independent from Store hierarchy.
      if (roleCode === "KAM") {
        const customers = await customerService.getAllCustomers();

        const equal = (value) => same(value, departmentCode) || same(value, departmentName);
        const accessibleCustomers = customers.filter((customer) =>
          equal(customer.salesDeptCode) ||
          equal(customer.salesDept) ||
          equal(customer.regionCode) ||
          equal(customer.region) ||
          equal(customer.districtCode) ||
          equal(customer.district)
        );
        let customerCodes = accessibleCustomers
          .map((customer) => clean(customer.customerCode))
          .filter(Boolean);
        let customerStoreCodes = [];
        let customerScopeSource = "CUSTOMER_FIELDS";

        // Some KAM departments (for example HQ.SLA) are represented on the
        // Store master as the Store Area/Sub-region rather than on the Customer
        // master Sales Dept/Region/District fields. In that case, derive the
        // KAM customer scope from Stores whose Area/Sub-region matches the
        // employee Department exactly. This fallback is KAM-only and does not
        // alter any other role's authorization logic.
        if (!customerCodes.length) {
          const stores = await storeService.getAllStores();
          const storeMatches = stores.filter((store) =>
            equal(store.departmentCode) ||
            equal(store.department) ||
            equal(store.subRegion) ||
            equal(store.subRegionCode)
          );
          customerStoreCodes = [...new Set(
            storeMatches.map((store) => clean(store.storeCode)).filter(Boolean)
          )];
          customerCodes = [...new Set(
            storeMatches.map((store) => clean(store.customerCode)).filter(Boolean)
          )];
          if (customerCodes.length || customerStoreCodes.length) customerScopeSource = "STORE_AREA";
        }

        if (customerCodes.length || customerStoreCodes.length) {
          return {
            allowed: true,
            accessLevel: "CUSTOMER",
            roleCode,
            role: roleName,
            district: "",
            region: "",
            subRegion: "",
            warehouseCode: "",
            customerDepartment: departmentName || departmentCode,
            customerCodes,
            customerStoreCodes,
            customerScopeSource,
          };
        }

        return {
          allowed: false,
          roleCode,
          role: roleName,
          reason: `No CUSTOMER Customer & Store Dashboard access scope is configured for department: ${departmentName || departmentCode}`,
        };
      }

      /*
       * Defensive HQ branch. ADMIN and CSH are handled above and therefore
       * never reach department validation. If another role is configured as
       * HQ in ROLE_ACCESS_LEVELS in the future, keep the existing defensive
       * department validation rather than silently granting HQ access.
       */
      if (requiredAccessLevel === "HQ") {
        if (
          department.startsWith("HQ.") ||
          ["ADMIN", "ALL", "HQ"].includes(department)
        ) {
          return {
            allowed: true,
            accessLevel: "HQ",
            roleCode,
            role: roleName,
            district: "",
            region: "",
            subRegion: "",
            warehouseCode: "",
          };
        }

        return {
          allowed: false,
          roleCode,
          role: roleName,
          reason: `HQ access is required for role '${roleCode}', but the employee department is '${departmentName || departmentCode || "UNASSIGNED"}'.`,
        };
      }

      /*
       * Non-HQ roles must resolve their Department against the hierarchy at
       * the LEVEL dictated by the role.
       *
       * We deliberately do NOT use a deepest-match search anymore.
       * Example:
       *   RSD + CLU -> DISTRICT lookup only
       *   RAM + CLU -> REGION lookup only
       *
       * This is what prevents CLU District / CLU Region naming collisions.
       */
      if (!departmentCode && !departmentName) {
        return {
          allowed: false,
          roleCode,
          role: roleName,
          reason: `No Customer & Store Dashboard access scope is configured because the employee department is blank.`,
        };
      }

      // Resolve the employee Department against ALL three hierarchy columns
      // using exact equality. The role still controls the access level/sheets;
      // the department value itself determines the data scope.
      // Example: Department = "SLU" matches Region = "SLU" exactly, but does
      // not match Sub-region = "Bicol" or District = "SLU District".
      // getStores() returns a page when no access is supplied. Resolve the
      // employee Department against the COMPLETE Store master, not only the
      // first 500 stores. Otherwise a valid department can incorrectly fail
      // authorization simply because its stores occur on a later page.
      const allStores = await storeService.getAllStores();

      const districtCodes = new Set();
      const regionCodes = new Set();
      const subRegionCodes = new Set();
      const districtNames = new Set();
      const regionNames = new Set();
      const subRegionNames = new Set();

      // Keep ONLY hierarchy values that exactly match the employee's
      // Department. Do not inherit the matched record's parent/child
      // hierarchy values. This preserves the business rule:
      // District == Department OR Region == Department OR
      // Sub-region == Department, using exact value equality.
      for (const store of allStores) {
        const districtCode = clean(store.territoryCode);
        const districtName = clean(store.territory);
        const regionCode = clean(store.regionCode);
        const regionName = clean(store.region);
        const subRegionCode = clean(store.departmentCode);
        const subRegionName = clean(store.department);

        if (same(department, districtCode)) districtCodes.add(districtCode);
        if (same(department, districtName)) districtNames.add(districtName);
        if (same(department, regionCode)) regionCodes.add(regionCode);
        if (same(department, regionName)) regionNames.add(regionName);
        if (same(department, subRegionCode)) subRegionCodes.add(subRegionCode);
        if (same(department, subRegionName)) subRegionNames.add(subRegionName);
      }

      if (districtCodes.size || regionCodes.size || subRegionCodes.size) {
        return {
          allowed: true,
          accessLevel: requiredAccessLevel,
          roleCode,
          role: roleName,
          district: [...districtCodes][0] || [...districtNames][0] || "",
          region: [...regionCodes][0] || [...regionNames][0] || "",
          subRegion: [...subRegionCodes][0] || [...subRegionNames][0] || "",
          warehouseCode: "",
          scopeMatches: {
            districtCodes: [...districtCodes],
            districtNames: [...districtNames],
            regionCodes: [...regionCodes],
            regionNames: [...regionNames],
            subRegionCodes: [...subRegionCodes],
            subRegionNames: [...subRegionNames],
          },
        };
      }

      const scopeLabel =
        requiredAccessLevel === "SUB_REGION"
          ? "AREA"
          : requiredAccessLevel;

      return {
        allowed: false,
        roleCode,
        role: roleName,
        reason: `No ${scopeLabel} Customer & Store Dashboard access scope is configured for department: ${departmentName || departmentCode}`,
      };
    },
  };
}
