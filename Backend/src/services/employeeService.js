import { rowsToObjects, escapeKingdeeValue, buildOrganizationFilter } from "../utils/kingdee.js";
import { getEmployee as getLocalEmployee, replaceEmployees } from "../database/kingdeeDataRepository.js";

const EMPLOYEE_FIELDS = [
  "FStaffNumber",
  "FName",
  "F_RTA_Department",
  "F_RTA_Department.FName",
  "F_RTA_Role",
  "F_RTA_Role.FNumber",
  "F_RTA_HireDate",
  "F_RTA_ResignDate",
  "FForbidStatus",
];

const ROLE_MAP = {
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

const clean = (value) => String(value ?? "").trim();

function isPastResignationDate(value) {
  const text = clean(value);
  if (!text) return false;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const resignationStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return resignationStart < todayStart;
}


function getRoleCode(row) {
  const direct = row?.["F_RTA_Role.FNumber"];
  if (direct !== null && direct !== undefined && clean(direct)) {
    return clean(direct).toUpperCase();
  }

  const relation = row?.F_RTA_Role;
  if (relation && typeof relation === "object") {
    return clean(relation.FNumber ?? relation.Number ?? relation.number).toUpperCase();
  }

  return "";
}

export function createEmployeeService({ kingdeeClient, scope }) {
  return {
    async getEmployeeByEmployeeNo(employeeNo) {
      const no = clean(employeeNo);
      if (!no) return null;

      // Authorization must use the current Kingdee Employee Master.
      // SQLite remains a local cache/reference, but must not override
      // current Role/Department values for access resolution.
      let rows = await kingdeeClient.executeBillQuery({
        formId: "BD_Empinfo",
        fieldKeys: EMPLOYEE_FIELDS,
        filterString: `(${buildOrganizationFilter(scope.organizationField, scope.organization)}) AND (FStaffNumber = '${escapeKingdeeValue(no)}')`,
        orderString: "FStaffNumber ASC",
        startRow: 0,
        limit: 10,
      });
      const localRows = rowsToObjects(rows, EMPLOYEE_FIELDS);
      if (localRows.length) replaceEmployees(localRows);

      // If Kingdee temporarily returns no employee record, retain the local
      // employee as a fallback. A successful live result always takes priority.
      if (localRows.length) rows = localRows;
      else {
        const local = getLocalEmployee(no);
        rows = local ? [local] : [];
      }

      for (const row of rows) {
        if (clean(row.FStaffNumber).toUpperCase() !== no.toUpperCase()) continue;

        const roleCode = getRoleCode(row);
        const role = ROLE_MAP[roleCode] || "";

        return {
          employeeNo: no,
          employeeName: clean(row.FName),
          salesNo: clean(row.FStaffNumber),
          department: clean(row["F_RTA_Department.FName"]),
          departmentCode: clean(row.F_RTA_Department),
          role,
          roleCode,
          hireDate: row.F_RTA_HireDate || "",
          resignDate: row.F_RTA_ResignDate || "",
          isActive: clean(row.FForbidStatus).toUpperCase() === "A" && !isPastResignationDate(row.F_RTA_ResignDate),
        };
      }

      return null;
    },
  };
}

export function getRoleMap() {
  return { ...ROLE_MAP };
}
