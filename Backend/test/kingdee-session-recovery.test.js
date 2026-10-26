import assert from "node:assert/strict";
import { test } from "node:test";
import { KingdeeClient } from "../src/kingdee/kingdeeClient.js";

const sessionLost = "Session information is lost, please log in again.";
const query = { formId: "BD_Empinfo", fieldKeys: ["FStaffNumber", "FName"], filterString: "FStaffNumber = 'T001'", limit: 10 };

function makeClient(cookie = "session=expired") {
  const client = new KingdeeClient({ baseUrl: "https://kingdee.example/k3cloud", erpAccount: "test-account", integrationUsername: "test-integration", appId: "test-app", appSecret: "test-secret" });
  client.cookie = cookie;
  return client;
}

function failedQuery(message = sessionLost) {
  return { Result: { ResponseStatus: { IsSuccess: false, Errors: [{ FieldName: null, Message: message, DIndex: 0 }] } } };
}

function mockRequests(t, responses) {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    const reply = responses.shift();
    assert.ok(reply, "Unexpected extra request");
    return Response.json(reply.body, { status: reply.status || 200, headers: reply.headers || {} });
  });
  return requests;
}

function successfulLogin(cookie = "session=fresh") {
  return { body: { LoginResultType: 1, Message: "Login successful" }, headers: { "Set-Cookie": cookie + "; Path=/; HttpOnly" } };
}

for (const shape of ["object", "array", "nested-array"]) {
  test(`refreshes an expired Kingdee cookie and repeats the employee query once (${shape})`, async (t) => {
    const error = failedQuery();
    const body = shape === "array" ? [error] : shape === "nested-array" ? [[error]] : error;
    const requests = mockRequests(t, [{ body }, successfulLogin(), { body: [["T001", "SSO employee"]] }]);
    const result = await makeClient().executeBillQuery(query);
    assert.deepEqual(result, [["T001", "SSO employee"]]);
    assert.equal(requests.length, 3);
    assert.match(requests[1].url, /AuthService\.LoginByAppSecret/);
    assert.equal(requests[0].options.headers.Cookie, "session=expired");
    assert.equal(requests[2].options.headers.Cookie, "session=fresh");
    assert.deepEqual(JSON.parse(requests[2].options.body), JSON.parse(requests[0].options.body));
  });
}

test("refreshes a newly obtained cookie that is already invalid", async (t) => {
  const requests = mockRequests(t, [successfulLogin("session=initial"), { body: failedQuery() }, successfulLogin(), { body: [["T001", "SSO employee"]] }]);
  assert.deepEqual(await makeClient(null).executeBillQuery(query), [["T001", "SSO employee"]]);
  assert.equal(requests.length, 4);
  assert.equal(requests[1].options.headers.Cookie, "session=initial");
  assert.equal(requests[3].options.headers.Cookie, "session=fresh");
});

test("stops after one retry when the refreshed session is rejected again", async (t) => {
  const requests = mockRequests(t, [{ body: failedQuery() }, successfulLogin(), { body: failedQuery() }]);
  await assert.rejects(makeClient().executeBillQuery(query), { message: sessionLost });
  assert.equal(requests.length, 3);
});

test("does not retry unrelated Kingdee business errors", async (t) => {
  const requests = mockRequests(t, [{ body: failedQuery("Employee query is not permitted") }]);
  await assert.rejects(makeClient().executeBillQuery(query), /Employee query is not permitted/);
  assert.equal(requests.length, 1);
});

test("does not retry an HTTP failure even when its body contains the session-loss text", async (t) => {
  const requests = mockRequests(t, [{ body: { message: sessionLost }, status: 500 }]);
  await assert.rejects(makeClient().executeBillQuery(query), /HTTP 500/);
  assert.equal(requests.length, 1);
});

test("preserves the authentication error if refreshing the Kingdee session fails", async (t) => {
  const requests = mockRequests(t, [{ body: failedQuery() }, { body: { LoginResultType: 0, Message: "Application authentication rejected" } }]);
  await assert.rejects(makeClient().executeBillQuery(query), /Application authentication rejected/);
  assert.equal(requests.length, 2);
});
