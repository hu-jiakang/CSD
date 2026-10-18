export function createDingTalkService({ config }) {
  const {
    clientId,
    clientSecret,
    corpId,
    agentId,
  } = config.dingtalk;

  const DINGTALK_API_BASE = "https://api.dingtalk.com";
  const DINGTALK_LEGACY_BASE = "https://oapi.dingtalk.com";

  function ensureConfigured() {
    const missing = [];

    if (!clientId) missing.push("DINGTALK_CLIENT_ID");
    if (!clientSecret) missing.push("DINGTALK_CLIENT_SECRET");
    if (!corpId) missing.push("DINGTALK_CORP_ID");
    if (!agentId) missing.push("DINGTALK_AGENT_ID");

    if (missing.length) {
      throw new Error(
        `DingTalk SSO is not configured. Missing: ${missing.join(", ")}`
      );
    }
  }

  async function parseResponse(response) {
    const text = await response.text();

    let body = {};

    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }

    if (!response.ok) {
      throw new Error(
        `DingTalk API HTTP ${response.status}: ${
          body?.message ||
          body?.errmsg ||
          text ||
          "Unknown error"
        }`
      );
    }

    return body;
  }

  async function postJson(url, body, headers = {}) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });

    return parseResponse(response);
  }

  async function getJson(url, headers = {}) {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    });

    return parseResponse(response);
  }

  async function getEnterpriseAccessToken() {
    ensureConfigured();

    const response = await postJson(
      `${DINGTALK_API_BASE}/v1.0/oauth2/accessToken`,
      {
        appKey: clientId,
        appSecret: clientSecret,
      }
    );

    const accessToken =
      response?.accessToken ||
      response?.access_token;

    if (!accessToken) {
      throw new Error(
        "DingTalk did not return an enterprise access token."
      );
    }

    return accessToken;
  }

  async function getUserInfoByAuthCode(
    enterpriseAccessToken,
    authCode
  ) {
    if (!enterpriseAccessToken) {
      throw new Error(
        "DingTalk enterprise access token is required."
      );
    }

    const code = String(authCode || "").trim();

    if (!code) {
      throw new Error(
        "DingTalk authorization code is required."
      );
    }

    const response = await postJson(
      `${DINGTALK_LEGACY_BASE}/topapi/v2/user/getuserinfo?access_token=${encodeURIComponent(
        enterpriseAccessToken
      )}`,
      {
        code,
      }
    );

    const userId = String(
      response?.result?.userid ||
      response?.result?.userId ||
      ""
    ).trim();

    if (!userId) {
      throw new Error(
        "DingTalk did not return a userid for the authorization code."
      );
    }

    return {
      userId,
      raw: response?.result || {},
    };
  }

  async function getEnterpriseUser(
    enterpriseAccessToken,
    userId
  ) {
    if (!enterpriseAccessToken) {
      throw new Error(
        "DingTalk enterprise access token is required."
      );
    }

    if (!userId) {
      throw new Error(
        "DingTalk userid is required."
      );
    }

    const response = await postJson(
      `${DINGTALK_LEGACY_BASE}/topapi/v2/user/get?access_token=${encodeURIComponent(
        enterpriseAccessToken
      )}`,
      {
        language: "en_US",
        userid: userId,
      }
    );

    return response?.result || {};
  }

  async function authenticate(authCode) {
    ensureConfigured();

    const code = String(authCode || "").trim();

    if (!code) {
      throw new Error(
        "DingTalk authorization code is required."
      );
    }

    const enterpriseAccessToken =
      await getEnterpriseAccessToken();

    const userInfo =
      await getUserInfoByAuthCode(
        enterpriseAccessToken,
        code
      );

    const enterpriseUser =
      await getEnterpriseUser(
        enterpriseAccessToken,
        userInfo.userId
      );

    const employeeNo = String(
      enterpriseUser?.job_number ||
      enterpriseUser?.jobnumber ||
      ""
    ).trim();

    if (!employeeNo) {
      throw new Error(
        "DingTalk user has no job number."
      );
    }

    return {
      provider: "dingtalk",
      providerSubject: String(
        enterpriseUser?.unionid ||
        enterpriseUser?.unionId ||
        userInfo.userId
      ).trim(),
      employeeNo,
      dingtalkUserId: userInfo.userId,
      displayName: String(
        enterpriseUser?.name || ""
      ).trim(),
      avatar: String(
        enterpriseUser?.avatar || ""
      ).trim(),
      active: enterpriseUser?.active !== false,
    };
  }

  return {
    clientId,
    corpId,
    agentId,
    authenticate,
  };
}
