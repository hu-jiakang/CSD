export function createAuthController({ authService }) {
  return {
    async login(req, res) {
      const { employeeNo, password } = req.body || {};
      try {
        const result = await authService.login(employeeNo, password);
        return res.status(result.status).json({ success: result.ok, ...result });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    },

    dingtalkConfig(req, res) {
      const configured = Boolean(
        authService.dingtalkConfig?.clientId &&
        authService.dingtalkConfig?.corpId
      );

      if (!configured) {
        return res.status(503).json({
          success: false,
          enabled: false,
          error: "DingTalk SSO is not configured."
        });
      }

      return res.json({
        success: true,
        enabled: true,
        clientId: authService.dingtalkConfig.clientId,
        corpId: authService.dingtalkConfig.corpId
      });
    },

    async loginWithDingTalk(req, res) {
      try {
        const authCode = String(req.body?.authCode || "").trim();

        if (!authCode) {
          return res.status(400).json({
            success: false,
            error: "DingTalk authorization code is required."
          });
        }

        const result = await authService.loginWithDingTalk(authCode);

        if (result.ok && result.token) {
          const maxAge = 8 * 60 * 60;
          res.setHeader(
            "Set-Cookie",
            `csd_dingtalk_session=${encodeURIComponent(result.token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`
          );
        }

        return res.status(result.status).json({
          success: result.ok,
          ...result
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          error: error.message
        });
      }
    },

    async changePassword(req, res) {
      try {
        const token = String(req.body?.passwordChangeToken || req.auth?.token || "");
        const result = await authService.changePassword(token, req.body?.newPassword);
        return res.status(result.status).json({ success: result.ok, ...result });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    },

    me(req, res) {
      res.json({
        success: true,
        employeeNo: req.employee?.employeeNo || req.auth.employee_no,
        employee: req.employee,
        access: req.access,
      });
    },

    logout(req, res) {
      authService.logout(req.auth.token);
      res.setHeader(
        "Set-Cookie",
        "csd_dingtalk_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"
      );
      res.json({ success: true });
    },

    async resetEmployeePassword(req, res) {
      try {
        if (String(req.auth?.employee_no || "").trim().toUpperCase() !== "ADMIN") {
          return res.status(403).json({ success: false, error: "ADMIN access is required." });
        }
        const result = await authService.resetEmployeePassword(req.body?.employeeNo);
        return res.status(result.status).json({ success: result.ok, ...result });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    },
  };
}
