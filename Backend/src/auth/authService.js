import { DEFAULT_FIRST_LOGIN_PASSWORD, ADMIN_USERNAME, ADMIN_PASSWORD, PASSWORD_MIN_LENGTH } from "./password.js";
import { authDb } from "../database.js";
import { ensureDefaultCredential, verifyCredential, setPassword, markLogin, resetPassword } from "./credentialStore.js";
import { createSession, getSession, deleteSession } from "./sessionStore.js";

export function createAuthService({ employeeService, accessService, dashboardSummaryService, dingtalkService }) {
  async function resolve(employeeNo) {
    const key = String(employeeNo || "").trim();
    const employee = await employeeService.getEmployeeByEmployeeNo(key);
    if (!employee) return null;

    // Resolve access from the current Employee Master values on every
    // authorization resolution. Do not retain a stale role/department scope.
    const access = await accessService.resolve(employee);
    return { employee, access };
  }

  async function loginWithDingTalk(authCode) {
    const identity = await dingtalkService.authenticate(authCode);

    const employeeNo = String(identity.employeeNo || "").trim();

    if (!employeeNo) {
      return {
        ok: false,
        status: 401,
        error: "DingTalk user has no Employee No."
      };
    }

    const resolved = await resolve(employeeNo);

    if (!resolved?.employee) {
      return {
        ok: false,
        status: 401,
        error: "DingTalk Employee No. was not found in Kingdee Employee Master."
      };
    }

    if (!resolved.employee.isActive) {
      return {
        ok: false,
        status: 403,
        error: "Employee is inactive or resigned and cannot log in."
      };
    }

    if (!resolved.access.allowed) {
      return {
        ok: false,
        status: 403,
        error: resolved.access.reason
      };
    }

    const session = createSession(resolved.employee.employeeNo);

    markLogin(resolved.employee.employeeNo);
    dashboardSummaryService?.warm(resolved.access);

    return {
      ok: true,
      status: 200,
      requiresPasswordChange: false,
      token: session.token,
      expiresAt: session.expiresAt,
      employee: resolved.employee,
      access: resolved.access,
      dingtalk: {
        provider: identity.provider,
        providerSubject: identity.providerSubject,
        dingtalkUserId: identity.dingtalkUserId,
        displayName: identity.displayName,
        avatar: identity.avatar
      }
    };
  }

  return {
    dingtalkConfig: {
      clientId: String(dingtalkService?.clientId || "").trim(),
      corpId: String(dingtalkService?.corpId || "").trim(),
    },

    async login(employeeNo, password) {
      const loginEmployeeNo = String(employeeNo || "").trim();

      // Dedicated ADMIN account. It is independent of Kingdee Employee Master
      // and is intentionally not subject to employee role/department lookup.
      if (loginEmployeeNo.toUpperCase() === ADMIN_USERNAME) {
        if (String(password ?? "") !== ADMIN_PASSWORD) {
          return {
            ok: false,
            status: 401,
            error: "Invalid Employee No. or password."
          };
        }

        const adminEmployee = {
          employeeNo: ADMIN_USERNAME,
          employeeName: "ADMIN",
          salesNo: ADMIN_USERNAME,
          department: "",
          departmentCode: "",
          role: "HQ Admin",
          roleCode: "ADMIN",
          hireDate: "",
          resignDate: "",
          isActive: true,
        };

        const adminAccess = {
          allowed: true,
          accessLevel: "HQ",
          roleCode: "ADMIN",
          role: "HQ Admin",
          district: "",
          region: "",
          subRegion: "",
          warehouseCode: "",
        };

        const session = createSession(ADMIN_USERNAME);

        return {
          ok: true,
          status: 200,
          requiresPasswordChange: false,
          token: session.token,
          expiresAt: session.expiresAt,
          employee: adminEmployee,
          access: adminAccess,
        };
      }

      const resolved = await resolve(loginEmployeeNo);

      if (!resolved?.employee) {
        return {
          ok: false,
          status: 401,
          error: "Employee No. was not found in Kingdee Employee Master."
        };
      }

      if (!resolved.employee.isActive) {
        return {
          ok: false,
          status: 403,
          error: "Employee is inactive or resigned and cannot log in."
        };
      }

      if (!resolved.access.allowed) {
        return {
          ok: false,
          status: 403,
          error: resolved.access.reason
        };
      }

      const credential = ensureDefaultCredential(resolved.employee.employeeNo);

      if (!verifyCredential(resolved.employee.employeeNo, password)) {
        return {
          ok: false,
          status: 401,
          error: "Invalid Employee No. or password."
        };
      }

      markLogin(resolved.employee.employeeNo);

      // Match the established EKSBASE standalone login flow:
      // first-time / pending password-change accounts are identified by
      // the persisted must_change_password flag.
      if (Number(credential.must_change_password) === 1) {
        const session = createSession(resolved.employee.employeeNo);

        dashboardSummaryService?.warm(resolved.access);

        return {
          ok: true,
          status: 200,
          requiresPasswordChange: true,
          passwordChangeToken: session.token,
          employee: resolved.employee,
          access: resolved.access,
        };
      }

      const session = createSession(resolved.employee.employeeNo);

      dashboardSummaryService?.warm(resolved.access);

      return {
        ok: true,
        status: 200,
        requiresPasswordChange: false,
        token: session.token,
        expiresAt: session.expiresAt,
        employee: resolved.employee,
        access: resolved.access,
      };
    },

    loginWithDingTalk,

    async changePassword(token, newPassword) {
      const session = getSession(token);

      if (!session) {
        return {
          ok: false,
          status: 401,
          error: "Password change session is invalid or expired."
        };
      }

      if (String(newPassword || "").length < PASSWORD_MIN_LENGTH) {
        return {
          ok: false,
          status: 400,
          error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
        };
      }

      const employeeNo = String(session.employee_no || "").trim();

      if (
        newPassword === employeeNo ||
        newPassword === DEFAULT_FIRST_LOGIN_PASSWORD
      ) {
        return {
          ok: false,
          status: 400,
          error: "New password cannot remain the initial password."
        };
      }

      setPassword(employeeNo, newPassword);
      deleteSession(token);

      const nextSession = createSession(session.employee_no);
      const resolved = await resolve(session.employee_no);

      if (resolved?.employee?.isActive && resolved?.access?.allowed) {
        dashboardSummaryService?.warm(resolved.access);
      }

      return {
        ok: true,
        status: 200,
        token: nextSession.token,
        expiresAt: nextSession.expiresAt
      };
    },

    async resetEmployeePassword(employeeNo) {
      const no = String(employeeNo || "").trim();

      if (!no) {
        return {
          ok: false,
          status: 400,
          error: "Employee No. is required."
        };
      }

      if (no.toUpperCase() === ADMIN_USERNAME) {
        return {
          ok: false,
          status: 400,
          error: "The ADMIN account cannot be reset through employee password reset."
        };
      }

      const resolved = await resolve(no);

      if (!resolved?.employee) {
        return {
          ok: false,
          status: 404,
          error: "Employee No. was not found in Kingdee Employee Master."
        };
      }

      if (!resolved.employee.isActive) {
        return {
          ok: false,
          status: 400,
          error: "Employee is inactive or resigned and cannot be reset."
        };
      }

      resetPassword(no);

      // Force any existing sessions for this employee to log in again
      // using the Employee No. temporary password and change it.
      authDb.prepare("DELETE FROM sessions WHERE employee_no = ?").run(no);

      return {
        ok: true,
        status: 200,
        employeeNo: no,
        temporaryPassword: no,
        requiresPasswordChange: true,
      };
    },

    authenticate(token) {
      return getSession(token);
    },

    async getAuthorizationContext(session) {
      if (!session) return null;

      if (
        String(session.employee_no || "").trim().toUpperCase() ===
        ADMIN_USERNAME
      ) {
        return {
          employee: {
            employeeNo: ADMIN_USERNAME,
            employeeName: "ADMIN",
            salesNo: ADMIN_USERNAME,
            department: "",
            departmentCode: "",
            role: "HQ Admin",
            roleCode: "ADMIN",
            hireDate: "",
            resignDate: "",
            isActive: true,
          },
          access: {
            allowed: true,
            accessLevel: "HQ",
            roleCode: "ADMIN",
            role: "HQ Admin",
            district: "",
            region: "",
            subRegion: "",
            warehouseCode: "",
          },
        };
      }

      const resolved = await resolve(session.employee_no);

      if (
        !resolved ||
        !resolved.employee.isActive ||
        !resolved.access.allowed
      ) {
        return null;
      }

      return resolved;
    },

    logout(token) {
      if (token) deleteSession(token);
    },
  };
}
