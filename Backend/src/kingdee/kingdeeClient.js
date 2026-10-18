import { login } from "./login.js";
import { buildQuery, executeBillQuery } from "./executeBillQuery.js";

export class KingdeeClient {
  constructor(config) {
    if (!config) {
      throw new Error("Kingdee configuration is required.");
    }

    const requiredFields = [
      "baseUrl",
      "erpAccount",
      "integrationUsername",
      "appId",
      "appSecret",
    ];

    for (const field of requiredFields) {
      if (!config[field]) {
        throw new Error(`Missing Kingdee configuration: ${field}`);
      }
    }

    this.baseUrl = this.normalizeBaseUrl(config.baseUrl);
    this.erpAccount = config.erpAccount;
    this.integrationUsername = config.integrationUsername;
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.languageId = Number(config.languageId || 2052);
    this.loginType = Number(config.loginType || 1);
    this.cookie = null;
  }

  normalizeBaseUrl(url) {
    let normalizedUrl = String(url)
      .trim()
      .replace(/\/+$/, "");

    if (!normalizedUrl.toLowerCase().endsWith("/k3cloud")) {
      normalizedUrl += "/k3cloud";
    }

    return normalizedUrl;
  }

  async login() {
    return login(this);
  }

  async executeBillQuery(options) {
    const query = buildQuery(options);
    return executeBillQuery(this, query);
  }
}
