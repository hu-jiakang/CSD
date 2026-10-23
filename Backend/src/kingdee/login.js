export async function login(client) {
  const url =
    `${client.baseUrl}/Kingdee.BOS.WebApi.ServicesStub.AuthService.LoginByAppSecret.common.kdsvc`;

  const payload = {
    acctID: client.erpAccount,
    username: client.integrationUsername,
    appid: client.appId,
    appsecret: client.appSecret,
    lcid: client.languageId,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AppId": client.appId,
      "X-AppSecret": client.appSecret,
    },
    body: JSON.stringify(payload),
    redirect: "follow",
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Kingdee third-party login failed. HTTP ${response.status}: ${responseText}`
    );
  }

  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error("Unable to parse Kingdee third-party login response.");
  }

  if (
    result.LoginResultType !== 1 &&
    result.LoginResultType !== "1"
  ) {
    throw new Error(
      result.Message ||
        result.message ||
        "Kingdee third-party login failed."
    );
  }

  const setCookie = response.headers.get("set-cookie");

  if (!setCookie) {
    throw new Error(
      "Kingdee third-party login succeeded, but no session cookie was returned."
    );
  }

  const cookie = setCookie
    .split(",")
    .map((item) => item.split(";")[0].trim())
    .join("; ");

  client.cookie = cookie;

  return { cookie, response: result };
}
