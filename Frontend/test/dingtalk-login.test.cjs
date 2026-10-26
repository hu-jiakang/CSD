const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(require.resolve("../js/app.js"), "utf8");

function createPage({ dd = {}, fetch = async () => { throw new Error("Unexpected request"); } } = {}) {
  const storage = new Map();
  const document = {
    body: { innerHTML: "" },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const window = { dd, navigator: { userAgent: "Browser" } };
  const context = vm.createContext({
    window, document, fetch, Headers, URLSearchParams, console, setTimeout, clearTimeout,
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
  });
  vm.runInContext(source, context);
  window.navigator.userAgent = "DingTalk";
  return { context, document, storage, run: (code) => vm.runInContext(code, context) };
}

async function settles(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("SSO did not settle")), 100); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test("micro-app authorization accepts legacy onSuccess callbacks", async () => {
  const page = createPage({ dd: {
    ready: (callback) => callback(),
    runtime: { permission: { requestAuthCode(options) {
      assert.equal(options.corpId, "corp-test");
      options.onSuccess?.({ code: "micro-app-code" });
    } } },
  } });
  assert.equal(await settles(page.run('requestDingTalkAuthCode({ corpId: "corp-test" })')), "micro-app-code");
});

test("micro-app authorization surfaces legacy onFail errors", async () => {
  const page = createPage({ dd: {
    runtime: { permission: { requestAuthCode: (options) => options.onFail?.({ errorMessage: "Permission denied" }) } },
  } });
  await assert.rejects(settles(page.run('requestDingTalkAuthCode({ corpId: "corp-test" })')), /Permission denied/);
});

test("micro-app authorization takes priority when both JSAPI variants exist", async () => {
  const page = createPage({ dd: {
    requestAuthCode: (options) => options.success({ code: "different-code-type" }),
    runtime: { permission: { requestAuthCode: (options) => options.onSuccess?.({ code: "micro-app-code" }) } },
  } });
  assert.equal(await settles(page.run('requestDingTalkAuthCode({ corpId: "corp-test" })')), "micro-app-code");
});

test("top-level JSAPI receives the application identity and supports promises", async () => {
  const page = createPage({ dd: { requestAuthCode(options) {
    assert.equal(options.clientId, "client-test");
    assert.equal(options.corpId, "corp-test");
    return Promise.resolve({ authCode: "modern-code" });
  } } });
  assert.equal(await settles(page.run('requestDingTalkAuthCode({ clientId: "client-test", corpId: "corp-test" })')), "modern-code");
});

test("an SDK that never becomes ready reports a timeout", async () => {
  const page = createPage({ dd: { ready() {}, runtime: { permission: { requestAuthCode() {} } } } });
  page.context.setTimeout = (callback) => setTimeout(callback, 1);
  await assert.rejects(settles(page.run('requestDingTalkAuthCode({ corpId: "corp-test" })')), /timed out/i);
});

test("failed automatic login leaves a visible login form with a retry action", async () => {
  const page = createPage({
    dd: { runtime: { permission: { requestAuthCode() {} } } },
    fetch: async () => new Response(JSON.stringify({ error: "SSO is not configured" }), { status: 503 }),
  });
  page.run("render()");
  assert.match(page.document.body.innerHTML, /id="loginForm"/);
  await page.run("autoLoginWithDingTalk()");
  assert.match(page.document.body.innerHTML, /id="loginForm"/);
  assert.match(page.document.body.innerHTML, /id="dingtalkLoginBtn"/);
  assert.equal(page.run("state.dingtalk.error"), "SSO is not configured");
  assert.equal(page.run("state.dingtalk.loading"), false);
});

test("a DingTalk login rejection preserves the server's identity error", async () => {
  const page = createPage({
    fetch: async () => new Response(JSON.stringify({ error: "Employee No. was not found" }), { status: 401 }),
  });
  await assert.rejects(page.run('api("/api/auth/dingtalk", { method: "POST" })'), /Employee No. was not found/);
});

test("an expired authenticated session still clears its stored token", async () => {
  const page = createPage({ fetch: async () => new Response("{}", { status: 401 }) });
  page.run('state.token = "expired"; sessionStorage.setItem("csd_token", "expired")');
  await assert.rejects(page.run('api("/api/auth/me")'), /session has expired/);
  assert.equal(page.storage.has("csd_token"), false);
  assert.equal(page.run("state.token"), "");
});

test("repeated clicks do not start parallel one-time-code login requests", async () => {
  let requests = 0;
  let rejectConfig;
  const page = createPage({ fetch: () => {
    requests += 1;
    return new Promise((_, reject) => { rejectConfig = reject; });
  } });
  const first = page.run("loginWithDingTalk()");
  const second = page.run("loginWithDingTalk()");
  rejectConfig(new Error("Config unavailable"));
  assert.equal(requests, 1);
  await Promise.all([first, second]);
});

test("automatic SSO cannot replace a password setup already in progress", async () => {
  let requests = 0;
  const page = createPage({ fetch: async () => {
    requests += 1;
    throw new Error("SSO must not start during password setup");
  } });
  page.run("state.loginInProgress = true");
  await page.run("loginWithDingTalk()");
  assert.equal(requests, 0);
  assert.equal(page.run("state.loginInProgress"), true);
});

test("password login cannot overlap an active SSO request", async () => {
  let requests = 0;
  const page = createPage({ fetch: async () => {
    requests += 1;
    throw new Error("Password login must not start during SSO");
  } });
  page.document.querySelector = () => ({ textContent: "", disabled: false, value: "test-value" });
  page.run("state.loginInProgress = true");
  await page.run("login({ preventDefault() {} })");
  assert.equal(requests, 0);
  assert.equal(page.run("state.loginInProgress"), true);
});

for (const method of ["dingtalk", "password"]) {
  test(`${method} login clears an incomplete session so user-context failures can be retried`, async () => {
    let logins = 0;
    const page = createPage({
      dd: { runtime: { permission: { requestAuthCode: (options) => options.onSuccess({ code: "auth-code" }) } } },
      fetch: async (path) => {
        if (path === "/api/auth/dingtalk/config") return Response.json({ corpId: "test-corp" });
        if (path === "/api/auth/me") return Response.json({ error: "User context unavailable" }, { status: 500 });
        logins += 1;
        return Response.json({ token: "incomplete-session" });
      },
    });
    if (method === "password") {
      page.document.querySelector = (selector) => ["#loginError", ".login-button", "#employeeNo", "#password"].includes(selector)
        ? { textContent: "", disabled: false, value: "test-value" } : null;
    }
    const action = method === "dingtalk" ? "loginWithDingTalk()" : "login({ preventDefault() {} })";
    await page.run(action);
    assert.equal(page.run("state.token"), "");
    assert.equal(page.storage.has("csd_token"), false);
    await page.run(action);
    assert.equal(logins, 2);
  });
}
