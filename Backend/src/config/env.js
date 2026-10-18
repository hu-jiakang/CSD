import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3002),
  nodeEnv: process.env.NODE_ENV || "development",
  databasePath: String(process.env.DATABASE_PATH || "./data/kingdee.db").trim(),
  authDatabasePath: String(process.env.AUTH_DATABASE_PATH || "./data/customer-store-dashboard.db").trim(),
  authDatabasePath: String(process.env.AUTH_DATABASE_PATH || "./data/customer-store-dashboard.db").trim(),
  kingdeeEnabled: String(process.env.KINGDEE_ENABLED || "false").toLowerCase() === "true",
  kingdeeSyncOnStartup: String(process.env.KINGDEE_SYNC_ON_STARTUP || "true").toLowerCase() !== "false",
  kingdeeSyncIntervalMinutes: Number(process.env.KINGDEE_SYNC_INTERVAL_MINUTES || 30),

  kingdee: {
    baseUrl: process.env.KINGDEE_BASE_URL,
    erpAccount: process.env.KINGDEE_ERP_ACCOUNT,
    integrationUsername: String(process.env.KINGDEE_INTEGRATION_USERNAME || "").trim(),
    appId: String(process.env.KINGDEE_APP_ID || "").trim(),
    appSecret: String(process.env.KINGDEE_APP_SECRET || "").trim(),
    languageId: Number(process.env.KINGDEE_LANGUAGE_ID || 2052),
  },

  scope: {
    organization: String(process.env.KINGDEE_ORGANIZATION || "100").trim(),
    organizationField:
      String(
        process.env.KINGDEE_ORGANIZATION_FIELD ||
          "FUseOrgId.FNumber"
      ).trim(),
  },

  dingtalk: {
    clientId: String(process.env.DINGTALK_CLIENT_ID || "").trim(),
    clientSecret: String(process.env.DINGTALK_CLIENT_SECRET || "").trim(),
    corpId: String(process.env.DINGTALK_CORP_ID || "").trim(),
    agentId: String(process.env.DINGTALK_AGENT_ID || "").trim(),
  },
};
