export function createAuthMiddleware({ authService }) {
  return async (req, res, next) => {
    try {
      const header = String(req.headers.authorization || "");
      const bearerToken = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

      const cookies = String(req.headers.cookie || "")
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .reduce((acc, part) => {
          const separator = part.indexOf("=");
          if (separator === -1) return acc;
          const key = part.slice(0, separator).trim();
          const value = part.slice(separator + 1).trim();
          acc[key] = value;
          return acc;
        }, {});

      const cookieToken = cookies.csd_dingtalk_session || "";
      const token = bearerToken || cookieToken;

      const session = authService.authenticate(token);
      if (!session) {
        return res.status(401).json({
          success: false,
          error: "Authentication required."
        });
      }

      const context = await authService.getAuthorizationContext(session);
      if (!context) {
        return res.status(403).json({
          success: false,
          error: "Authorization scope is no longer valid."
        });
      }

      req.auth = session;
      req.employee = context.employee;
      req.access = context.access;
      next();
    } catch (error) {
      next(error);
    }
  };
}
