import { getDepartments } from "../database/kingdeeDataRepository.js";

const clean = (value) => String(value ?? "").trim();

function normalizeDepartment(row) {
  if (!row) return null;
  return {
    ...row,
    departmentCode: clean(row.FNumber),
    departmentName: clean(row.FName),
    territoryCode: clean(row["F_RTA_Territory.FNumber"]),
    territoryName: clean(row["F_RTA_Territory.FName"]),
  };
}

export function createDepartmentService() {
  const cache = new Map();
  return {
    async getTerritoryLookup(departmentCodes = []) {
      const codes = [...new Set(departmentCodes.map((value) => clean(value)).filter(Boolean))];
      if (!codes.length) return {};

      const rawLookup = getDepartments(codes);
      const lookup = {};

      for (const [key, value] of Object.entries(rawLookup)) {
        const normalized = normalizeDepartment(value);
        if (!normalized) continue;
        const normalizedKey = clean(key);
        if (normalizedKey) {
          lookup[normalizedKey] = normalized;
          cache.set(normalizedKey, normalized);
        }
        if (normalized.departmentCode) {
          lookup[normalized.departmentCode] = normalized;
          cache.set(normalized.departmentCode, normalized);
        }
        if (normalized.departmentName) {
          lookup[normalized.departmentName] = normalized;
          cache.set(normalized.departmentName, normalized);
        }
      }

      return lookup;
    },
    clearCache() { cache.clear(); },
  };
}
