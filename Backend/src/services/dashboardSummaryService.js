const CUSTOMER_VISIBLE_ROLES = new Set([
  "ADMIN",
  "CSH",
  "RSD",
  "LA",
  "RAM",
  "RSH",
  "KAM",
]);

const clean = (value) => String(value ?? "").trim();
const upper = (value) => clean(value).toUpperCase();

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map();
const inFlight = new Map();

function roleCode(access) {
  return upper(access?.roleCode || access?.role);
}

function canViewCustomers(access) {
  return CUSTOMER_VISIBLE_ROLES.has(roleCode(access));
}

function normalizeScopeValue(value) {
  return upper(value);
}

function sameScope(a, b) {
  const av = normalizeScopeValue(a);
  const bv = normalizeScopeValue(b);
  return Boolean(av) && av === bv;
}

function scopeKey(access) {
  return JSON.stringify({
    roleCode: roleCode(access),
    accessLevel: upper(access?.accessLevel),
    customerDepartment: clean(access?.customerDepartment),
    district: clean(access?.district),
    region: clean(access?.region),
    subRegion: clean(access?.subRegion),
    warehouseCode: clean(access?.warehouseCode),
    scopeMatches: access?.scopeMatches || {},
    customerCodes: [...(access?.customerCodes || [])].map(clean).filter(Boolean).sort(),
    customerStoreCodes: [...(access?.customerStoreCodes || [])].map(clean).filter(Boolean).sort(),
  });
}

function cacheGet(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.createdAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function cacheSet(key, data) {
  cache.set(key, { createdAt: Date.now(), data });
  return data;
}

function valueForLevel(item, level) {
  switch (level) {
    case "district":
      return clean(item.districtCode || item.district);
    case "region":
      return clean(item.regionCode || item.region);
    case "subRegion":
      return clean(item.subRegionCode || item.subRegion || item.salesDeptCode || item.salesDept);
    case "store":
      return clean(item.storeCode);
    default:
      return "";
  }
}

function labelForLevel(item, level) {
  switch (level) {
    case "district":
      return clean(item.district) || clean(item.districtCode);
    case "region":
      return clean(item.region) || clean(item.regionCode);
    case "subRegion":
      return clean(item.subRegion) || clean(item.department) || clean(item.salesDept) || clean(item.subRegionCode);
    case "store":
      return clean(item.storeName) || clean(item.storeCode);
    default:
      return "";
  }
}

function matchesParent(store, level, parentValue) {
  if (!parentValue) return true;
  const target = upper(parentValue);
  if (level === "region") return sameScope(store.districtCode, parentValue) || sameScope(store.district, parentValue);
  if (level === "subRegion") return sameScope(store.regionCode, parentValue) || sameScope(store.region, parentValue);
  if (level === "store") return sameScope(store.subRegionCode, parentValue) || sameScope(store.subRegion, parentValue);
  return true;
}

function customerGroupValue(customer, level) {
  if (level === "district") return clean(customer.district) || clean(customer.districtCode);
  if (level === "region") return clean(customer.region) || clean(customer.regionCode);
  if (level === "subRegion") return clean(customer.salesDept) || clean(customer.salesDeptCode);
  return "";
}

function buildRows({ stores, customers, bindings, level, parentValue, customerAllowed, kamAccess, allStores = stores }) {
  const scopedStores = stores.filter((store) => matchesParent(store, level, parentValue));
  const activeStoreCodes = new Set(scopedStores.map((store) => upper(store.storeCode)).filter(Boolean));
  const allStoreByCode = new Map(allStores.map((store) => [upper(store.storeCode), store]));
  const customerByCode = new Map(customers.map((customer) => [upper(customer.customerCode), customer]));
  const bindingCountByStore = new Map();

  for (const binding of bindings) {
    const code = upper(binding.storeCode);
    if (!code) continue;
    bindingCountByStore.set(code, (bindingCountByStore.get(code) || 0) + 1);
  }

  const groups = new Map();
  const ensureGroup = ({ key, label, type = level }) => {
    const normalizedKey = upper(key || label);
    if (!normalizedKey) return null;
    if (!groups.has(normalizedKey)) {
      groups.set(normalizedKey, {
        type,
        key: key || label,
        label: label || key || "Unassigned",
        storeCount: 0,
        bindingCount: 0,
        customerCodes: new Set(),
        searchParts: [],
      });
    }
    return groups.get(normalizedKey);
  };

  const assignedCustomerCodes = new Set();
  for (const store of scopedStores) {
    let label = labelForLevel(store, level);
    if (!label && roleCode(kamAccess) === "KAM") {
      const customer = customerByCode.get(upper(store.customerCode));
      label = clean(customer?.salesDept) || clean(customer?.salesDeptCode);
    }
    if (!label) label = "Unassigned";

    const key = valueForLevel(store, level) || label;
    const group = ensureGroup({ key, label });
    if (!group) continue;

    group.storeCount += 1;
    group.bindingCount += bindingCountByStore.get(upper(store.storeCode)) || 0;
    group.searchParts.push(label, store.storeCode, store.storeName);

    const customerCode = upper(store.customerCode);
    const customer = customerByCode.get(customerCode);
    if (customer && !assignedCustomerCodes.has(customerCode)) {
      group.customerCodes.add(customerCode);
      assignedCustomerCodes.add(customerCode);
      group.searchParts.push(customer.customerName, customer.customerCode);
    }
  }

  if (customerAllowed && level !== "store" && !parentValue) {
    const unassignedCustomers = customers.filter((customer) => !assignedCustomerCodes.has(upper(customer.customerCode)));
    if (unassignedCustomers.length) {
      const group = ensureGroup({ key: "Unassigned", label: "Unassigned" });
      if (group) {
        for (const customer of unassignedCustomers) {
          const code = upper(customer.customerCode);
          if (!code) continue;
          group.customerCodes.add(code);
          group.searchParts.push(customer.customerName, customer.customerCode);
        }
      }
    }
  }

  return [...groups.values()]
    // Store-tab hierarchy rows must represent actual Stores. Unlinked customers
    // can be counted internally, but must never create an empty Store row such
    // as "Unassigned" when its Store count is zero.
    .filter((group) => group.storeCount > 0)
    .map((group) => ({
      type: group.type,
      key: group.key,
      label: group.label,
      storeCount: group.storeCount,
      customerCount: group.customerCodes.size,
      bindingCount: group.bindingCount,
      searchText: group.searchParts.filter(Boolean).join(" "),
    }))
    .sort((a, b) => (Number(b.storeCount) - Number(a.storeCount)) || clean(a.label).localeCompare(clean(b.label)));
}

function customerLevelForAccess(access) {
  // Customer hierarchy is strictly: HQ -> District -> Region -> Customer.
  // Access level may start the user at a lower scope, but must never introduce
  // Store Sub-region or Sales Department into the Customer tab.
  const level = upper(access?.accessLevel);
  if (level === "HQ" || level === "ADMIN") return "district";
  if (level === "DISTRICT") return "region";
  if (level === "REGION") return "customer";
  if (level === "CUSTOMER") return "customer";
  return "district";
}

function normalizeCustomerRequestedLevel(level, fallback) {
  const requested = upper(level);
  if (!requested) return fallback;
  if (requested === "DISTRICT") return "district";
  if (requested === "REGION") return "region";
  if (requested === "CUSTOMER") return "customer";

  // Older frontend builds used the Store hierarchy's next-level names when
  // drilling inside the Customer tab. Treat those names only as compatibility
  // aliases for the Customer leaf. They must never expose Sales Department,
  // Sub-region, or Store as a Customer hierarchy level.
  if (requested === "SUBREGION" || requested === "SUB_REGION" || requested === "SALESDEPT" || requested === "SALES_DEPT" || requested === "STORE") {
    return "customer";
  }

  return fallback;
}

function customerValueForLevel(customer, level) {
  switch (level) {
    case "district": return clean(customer.districtCode || customer.district);
    case "region": return clean(customer.regionCode || customer.region);
    case "customer": return clean(customer.customerCode);
    default: return "";
  }
}

function customerLabelForLevel(customer, level) {
  switch (level) {
    case "district": return clean(customer.district) || clean(customer.districtCode);
    case "region": return clean(customer.region) || clean(customer.regionCode);
    case "customer": return clean(customer.customerName) || clean(customer.customerCode);
    default: return "";
  }
}

function matchesCustomerParent(customer, level, parentValue) {
  if (!parentValue) return true;
  if (level === "region") return sameScope(customer.districtCode, parentValue) || sameScope(customer.district, parentValue);
  if (level === "customer") return sameScope(customer.regionCode, parentValue) || sameScope(customer.region, parentValue);
  return true;
}

function buildCustomerRows({ customers, activeCustomerStoreCountByCustomer, level, parentValue }) {
  const activeStoreCountByCustomer = activeCustomerStoreCountByCustomer || new Map();

  const scopedCustomers = customers.filter((customer) => matchesCustomerParent(customer, level, parentValue));
  const groups = new Map();
  const ensureGroup = (key, label, type = level) => {
    const normalizedKey = upper(key || label);
    if (!normalizedKey) return null;
    if (!groups.has(normalizedKey)) groups.set(normalizedKey, {
      type, key: key || label, label: label || key || "Unassigned",
      customerCount: 0, storeCount: 0, searchParts: [],
    });
    return groups.get(normalizedKey);
  };

  for (const customer of scopedCustomers) {
    const key = customerValueForLevel(customer, level) || "Unassigned";
    const label = customerLabelForLevel(customer, level) || "Unassigned";
    const group = ensureGroup(key, label);
    if (!group) continue;
    group.customerCount += 1;
    group.storeCount += activeStoreCountByCustomer.get(upper(customer.customerCode)) || 0;
    group.searchParts.push(label, customer.customerCode, customer.customerName, customer.customerShortName);
  }

  return [...groups.values()]
    .map((group) => ({
      type: group.type,
      key: group.key,
      label: group.label,
      customerCount: group.customerCount,
      storeCount: group.storeCount,
      bindingCount: 0,
      searchText: group.searchParts.filter(Boolean).join(" "),
    }))
    .sort((a, b) => (Number(b.customerCount) - Number(a.customerCount)) || (Number(b.storeCount) - Number(a.storeCount)) || clean(a.label).localeCompare(clean(b.label)));
}

function buildActiveCustomerStoreCountByCustomer(customerStoreStores, activeCustomers) {
  // Customer Store Count is intentionally Customer-basis: start from the
  // active Customers in the user's Customer access scope, then count their
  // active linked Stores from the full Customer->Store relationship set.
  // The Store's own District/Region/Sub-region must NOT restrict this count.
  const counts = new Map();
  const activeCustomerCodes = new Set(
    (activeCustomers || [])
      .map((customer) => upper(customer.customerCode))
      .filter(Boolean)
  );
  const seenByCustomer = new Map();

  for (const store of customerStoreStores || []) {
    const customerCode = upper(store.customerCode);
    const storeCode = upper(store.storeCode);
    if (!customerCode || !storeCode) continue;
    if (!activeCustomerCodes.has(customerCode)) continue;
    // Store active/inactive status comes from the Store master mapping.
    if (store.disabled) continue;
    if (!seenByCustomer.has(customerCode)) seenByCustomer.set(customerCode, new Set());
    seenByCustomer.get(customerCode).add(storeCode);
  }

  for (const customerCode of activeCustomerCodes) {
    counts.set(customerCode, seenByCustomer.get(customerCode)?.size || 0);
  }
  return counts;
}

function rootLevelForAccess(access) {
  const level = upper(access?.accessLevel);
  if (level === "HQ" || level === "ADMIN") return "district";
  if (level === "DISTRICT") return "region";
  if (level === "REGION") return "subRegion";
  if (level === "SUB_REGION") return "store";
  if (level === "CUSTOMER") return "store";
  return "district";
}

export function createDashboardSummaryService({ customerStoreService, bindingService }) {
  async function loadBaseData(access, { fresh = false } = {}) {
    const key = scopeKey(access);
    const cached = cacheGet(key);
    if (cached) return cached;
    const existing = inFlight.get(key);
    if (existing) return existing;

    const promise = (async () => {
      const result = await customerStoreService.getAllCustomerStores({ access, fresh });
      const bindings = await bindingService.getBindings({
        access,
        authorizedStores: result.storeRows,
      });
      return cacheSet(key, {
        // Store-tab data is already filtered by Store geography/access.
        stores: result.storeRows || [],
        // Customer-tab data is Customer-basis. Keep the unfiltered linked-store
        // set separately so Customer Store Count is NOT restricted by the
        // linked Store's District/Region/Sub-region.
        customers: result.customerRows || [],
        customerStoreStores: result.customerStoreStores || [],
        customerStoreRows: result.customerStoreRows || [],
        bindings: bindings || [],
      });
    })();

    inFlight.set(key, promise);
    try { return await promise; }
    finally { if (inFlight.get(key) === promise) inFlight.delete(key); }
  }

  return {
    warm(access) {
      if (!access) return;
      // The Excel export intentionally uses a fresh Customer/Store extraction.
      // Warm the dashboard summary from the same fresh source once per login so
      // the summary cannot remain on an older cached mapping while the export
      // shows the current District values. Subsequent summary/drilldown requests
      // continue to use the normal short-lived dashboard cache.
      loadBaseData(access).catch(() => {});
    },

    async getSummary({ access, view = "stores", level, parentValue, storeCode = "", search = "" } = {}) {
      const data = await loadBaseData(access);
      const customerAllowed = canViewCustomers(access);
      const activeStores = data.stores.filter((store) => !store.disabled);
      const activeCustomers = data.customers.filter((customer) => !customer.disabled);
      const activeBindings = data.bindings.filter((binding) => !binding.inactivePsNhtFl);
      const safeView = customerAllowed && clean(view).toLowerCase() === "customers" ? "customers" : "stores";

      if (safeView === "customers") {
        const rootLevel = customerLevelForAccess(access);
        const safeLevel = normalizeCustomerRequestedLevel(level, rootLevel);
        const scopedCustomers = activeCustomers.filter((customer) => matchesCustomerParent(customer, safeLevel, clean(parentValue)));
        const scopedCustomerCodes = new Set(scopedCustomers.map((customer) => upper(customer.customerCode)).filter(Boolean));
        const activeCustomerStoreCountByCustomer = buildActiveCustomerStoreCountByCustomer(
          data.customerStoreStores,
          activeCustomers
        );
        const scopedStoreCount = [...scopedCustomerCodes].reduce((sum, code) => sum + (activeCustomerStoreCountByCustomer.get(code) || 0), 0);
        const rows = buildCustomerRows({
          customers: activeCustomers,
          activeCustomerStoreCountByCustomer,
          level: safeLevel,
          parentValue: clean(parentValue),
        });
        const q = upper(search);
        const filteredRows = q ? rows.filter((row) => upper(`${row.label} ${row.key} ${row.searchText}`).includes(q)) : rows;
        return {
          success: true, view: "customers", rootLevel, level: safeLevel,
          hierarchy: ["district", "region", "customer"],
          hierarchyLabel: "HQ -> District -> Region -> Customer",
          totalStores: data.stores.length, activeStores: activeStores.length,
          totalCustomers: data.customers.length, activeCustomers: activeCustomers.length,
          totalBindings: data.bindings.length, activeBindings: activeBindings.length,
          customerVisible: true,
          areaRows: filteredRows,
          // Customer tab is Customer-basis: the root Total Active row must
          // represent every active authorized Customer and every active Store
          // linked to those Customers. Child rows remain grouped by the
          // Customer hierarchy and are never derived from Store grouping.
          summaryTotals: { customerCount: scopedCustomers.length, storeCount: scopedStoreCount, bindingCount: 0 },
          generatedAt: new Date().toISOString(),
        };
      }

      const rootLevel = rootLevelForAccess(access);
      const requestedLevel = clean(level) || rootLevel;
      const safeLevel = ["district", "region", "subRegion", "store"].includes(requestedLevel) ? requestedLevel : rootLevel;
      const scopedStores = storeCode
        ? activeStores.filter((store) => sameScope(store.storeCode, storeCode))
        : activeStores.filter((store) => matchesParent(store, safeLevel, clean(parentValue)));
      const scopedStoreCodes = new Set(scopedStores.map((store) => upper(store.storeCode)).filter(Boolean));
      const activeStoreByCode = new Map(activeStores.map((store) => [upper(store.storeCode), store]));
      const allStoreByCode = new Map(data.stores.map((store) => [upper(store.storeCode), store]));
      const scopedBindings = safeLevel === "store"
        ? activeBindings.filter((binding) => scopedStoreCodes.has(upper(binding.storeCode)))
        : activeBindings.filter((binding) => {
            const code = upper(binding.storeCode);
            if (scopedStoreCodes.has(code)) return true;
            const store = activeStoreByCode.get(code) || allStoreByCode.get(code);
            return !store && !parentValue;
          });
      const rows = buildRows({
        stores: scopedStores,
        customers: customerAllowed ? activeCustomers : [],
        bindings: activeBindings,
        level: safeLevel,
        parentValue: clean(parentValue),
        customerAllowed,
        kamAccess: access,
        allStores: activeStores,
      });
      const q = upper(search);
      const filteredRows = q ? rows.filter((row) => upper(`${row.label} ${row.key} ${row.searchText}`).includes(q)) : rows;
      const activeCustomerCodes = new Set(activeCustomers.map((customer) => upper(customer.customerCode)).filter(Boolean));
      const scopedCustomerCodes = new Set();
      for (const store of scopedStores) {
        const code = upper(store.customerCode);
        if (code && activeCustomerCodes.has(code)) scopedCustomerCodes.add(code);
      }
      const scopedCustomerCount = customerAllowed ? scopedCustomerCodes.size : 0;
      return {
        success: true, view: "stores", rootLevel, level: safeLevel,
        totalStores: data.stores.length, activeStores: activeStores.length,
        totalCustomers: customerAllowed ? data.customers.length : 0,
        activeCustomers: customerAllowed ? activeCustomers.length : 0,
        totalBindings: data.bindings.length, activeBindings: activeBindings.length,
        customerVisible: customerAllowed,
        areaRows: filteredRows,
        // At the Store-tab root, the Total Active binding figure must match the
        // Active Binded PS/NHT/FL KPI. Bindings that do not currently have an
        // active Store are intentionally not shown as an "Unassigned" row, but
        // remain included in the root total. Child levels remain strictly
        // Store-basis and therefore use only bindings attached to the scoped
        // active Stores.
        summaryTotals: {
          storeCount: scopedStores.length,
          customerCount: scopedCustomerCount,
          bindingCount: !parentValue && !storeCode ? activeBindings.length : scopedBindings.length,
        },
        generatedAt: new Date().toISOString(),
      };
    },

    clearCache() { cache.clear(); },
  };
}
