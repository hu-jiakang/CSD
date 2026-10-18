export function buildQuery({
  formId,
  fieldKeys,
  filterString = "",
  orderString = "",
  startRow = 0,
  limit = 500,
}) {
  const normalizedFormId = String(formId || "").trim();

  if (!normalizedFormId) {
    throw new Error("FormId is required.");
  }

  const normalizedFieldKeys = Array.isArray(fieldKeys)
    ? fieldKeys
        .map((field) => String(field || "").trim())
        .filter(Boolean)
        .join(",")
    : String(fieldKeys || "")
        .split(",")
        .map((field) => field.trim())
        .filter(Boolean)
        .join(",");

  if (!normalizedFieldKeys) {
    throw new Error("At least one Kingdee field key is required.");
  }

  return {
    FormId: normalizedFormId,
    FieldKeys: normalizedFieldKeys,
    FilterString: String(filterString || "").trim(),
    OrderString: String(orderString || "").trim(),
    TopRowCount: 0,
    StartRow: Math.max(0, Number(startRow) || 0),
    Limit: Math.max(1, Number(limit) || 500),
  };
}

function extractError(result) {
  const errors =
    result?.Result?.ResponseStatus?.Errors ||
    result?.ResponseStatus?.Errors ||
    [];

  const message = errors
    .map((error) => error?.Message)
    .filter(Boolean)
    .join(" | ");

  return message || "Kingdee query returned an unsuccessful response.";
}

export async function executeBillQuery(client, query) {
  if (!client.cookie) {
    await client.login();
  }

  try {
    return await executeBillQueryOnce(client, query);
  } catch (error) {
    const message = String(error?.message || "");

    // K3Cloud expires third-party sessions server-side. When that happens,
    // the API answers with "Session information is lost, please log in
    // again." Re-login once and retry instead of failing the request —
    // the sync scheduler and the live employee/permission lookups in the
    // login flow all depend on this.
    if (message.includes("Session information is lost")) {
      client.cookie = null;
      await client.login();
      return await executeBillQueryOnce(client, query);
    }

    throw error;
  }
}

async function executeBillQueryOnce(client, query) {
  const endpoint =
    `${client.baseUrl}/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.ExecuteBillQuery.common.kdsvc`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Cookie: client.cookie,
    },
    body: JSON.stringify({ data: query }),
    redirect: "follow",
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Kingdee query failed. HTTP ${response.status}: ${responseText}`
    );
  }

  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error("Unable to parse Kingdee query response.");
  }

  if (Array.isArray(result)) {
    const firstItem = Array.isArray(result[0])
      ? result[0][0]
      : result[0];

    if (firstItem?.Result?.ResponseStatus?.IsSuccess === false) {
      throw new Error(extractError(firstItem));
    }

    return result;
  }

  if (result?.Result?.ResponseStatus?.IsSuccess === false) {
    throw new Error(extractError(result));
  }

  if (Array.isArray(result?.Result?.Result)) return result.Result.Result;
  if (Array.isArray(result?.Result)) return result.Result;
  if (Array.isArray(result?.Data)) return result.Data;
  if (Array.isArray(result?.data)) return result.data;

  throw new Error(
    `Unexpected Kingdee query response: ${responseText}`
  );
}
