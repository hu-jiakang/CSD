const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(require.resolve("../js/app.js"), "utf8");

function createPage({ dd = {}, storedToken = "", userAgent = "Browser", timers = { setTimeout, clearTimeout }, fetch = async () => { throw new Error("Unexpected request"); } } = {}) {
  const storage = new Map();
  if (storedToken) storage.set("csd_token", storedToken);
  const bodyClasses = new Set();
  const renders = [];
  const document = {
    body: {
      get innerHTML() { return renders.at(-1) || ""; },
      set innerHTML(html) { renders.push(html); },
      classList: {
        toggle(name, enabled) { if (enabled) bodyClasses.add(name); else bodyClasses.delete(name); },
      },
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const window = { dd, navigator: { userAgent } };
  const context = vm.createContext({
    window, document, fetch, Headers, URLSearchParams, AbortController, console,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
  });
  const startup = vm.runInContext(source, context);
  window.navigator.userAgent = "DingTalk";
  return { context, document, storage, startup, renders, bodyClasses, run: (code) => vm.runInContext(code, context) };
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

test("DingTalk startup stays blank while waiting for the SDK, then shows a retry on failure", async () => {
  const page = createPage({ userAgent: "DingTalk" });
  assert.equal(page.document.body.innerHTML, "");
  assert.equal(page.bodyClasses.has("auth-loading"), true);
  page.context.setTimeout = (callback) => { queueMicrotask(callback); return 0; };
  await page.startup;
  assert.match(page.document.body.innerHTML, /id="loginForm"/);
  assert.match(page.document.body.innerHTML, /id="dingtalkLoginBtn"/);
  assert.match(page.run("state.dingtalk.error"), /not available/);
  assert.equal(page.bodyClasses.has("auth-loading"), false);
});

test("DingTalk startup stays blank through configuration, authorization, and user lookup", async () => {
  let releaseConfig;
  let authorize;
  let releaseUser;
  let userRequested;
  const userRequest = new Promise((resolve) => { userRequested = resolve; });
  const page = createPage({
    userAgent: "DingTalk",
    dd: { runtime: { permission: { requestAuthCode(options) { authorize = options.onSuccess; } } } },
    fetch: async (path) => {
      if (path === "/api/auth/dingtalk/config") return new Promise((resolve) => { releaseConfig = resolve; });
      if (path === "/api/auth/dingtalk") return Response.json({ token: "fresh-session" });
      if (path === "/api/auth/me") {
        userRequested();
        return new Promise((resolve) => { releaseUser = resolve; });
      }
      if (path.startsWith("/api/dashboard-summary")) return Response.json({ areaRows: [] });
      throw new Error("Unexpected request: " + path);
    },
  });
  assert.equal(page.document.body.innerHTML, "");
  releaseConfig(Response.json({ corpId: "test-corp" }));
  while (!authorize) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.document.body.innerHTML, "");
  authorize({ code: "test-code" });
  await userRequest;
  assert.equal(page.document.body.innerHTML, "");
  releaseUser(Response.json({ employee: { employeeNo: "T001" }, access: { accessLevel: "HQ" } }));
  await page.startup;
  assert.match(page.document.body.innerHTML, /class="app-shell"/);
  assert.equal(page.renders.some((html) => html.includes('id="loginForm"')), false);
  assert.equal(page.bodyClasses.has("auth-loading"), false);
});

for (const expired of [false, true]) {
  test(`DingTalk startup never flashes login while ${expired ? "recovering an expired" : "checking a valid"} stored session`, async () => {
    let releaseUser;
    let meCalls = 0;
    const page = createPage({
      storedToken: "stored-session", userAgent: "DingTalk",
      dd: { runtime: { permission: { requestAuthCode: (options) => options.onSuccess({ code: "fresh-code" }) } } },
      fetch: async (path) => {
        if (path === "/api/auth/me") {
          if (++meCalls === 1) return new Promise((resolve) => { releaseUser = resolve; });
          return Response.json({ employee: { employeeNo: "T001" }, access: { accessLevel: "HQ" } });
        }
        if (path === "/api/auth/dingtalk/config") return Response.json({ corpId: "test-corp" });
        if (path === "/api/auth/dingtalk") return Response.json({ token: "fresh-session" });
        if (path.startsWith("/api/dashboard-summary")) return Response.json({ areaRows: [] });
        throw new Error("Unexpected request: " + path);
      },
    });
    assert.equal(page.document.body.innerHTML, "");
    releaseUser(expired
      ? Response.json({ error: "Authentication required" }, { status: 401 })
      : Response.json({ employee: { employeeNo: "T001" }, access: { accessLevel: "HQ" } }));
    await page.startup;
    assert.equal(page.renders.some((html) => html.includes('id="loginForm"')), false);
    assert.match(page.document.body.innerHTML, /class="app-shell"/);
    assert.equal(page.bodyClasses.has("auth-loading"), false);
  });
}

test("ordinary browser startup shows password login immediately", async () => {
  const page = createPage();
  assert.match(page.document.body.innerHTML, /id="loginForm"/);
  assert.equal(page.bodyClasses.has("auth-loading"), false);
  await page.startup;
});

function createClock() {
  let now = 0;
  const pending = new Map();
  return {
    setTimeout(callback, delay) {
      const handle = {};
      pending.set(handle, { callback, due: now + delay });
      return handle;
    },
    clearTimeout(handle) { pending.delete(handle); },
    advance(milliseconds) {
      now += milliseconds;
      for (const [handle, timer] of pending) {
        if (timer.due <= now) {
          pending.delete(handle);
          timer.callback();
        }
      }
    },
  };
}

for (const path of ["/api/auth/dingtalk/config", "/api/auth/dingtalk", "/api/auth/me"]) {
  for (const stage of ["headers", "body"]) {
    test(`startup leaves the blank screen when ${path} stalls at response ${stage}, and retry works`, async () => {
      const timers = createClock();
      let stalled;
      let shouldStall = true;
      let aborted = false;
      const pendingRequest = new Promise((resolve) => { stalled = resolve; });
      const page = createPage({
        userAgent: "DingTalk", timers,
        dd: { runtime: { permission: { requestAuthCode: (options) => options.onSuccess({ code: "test-code" }) } } },
        fetch: async (requestPath, options) => {
          if (requestPath === path && shouldStall) {
            const hang = () => new Promise((resolve, reject) => {
              options.signal?.addEventListener("abort", () => {
                aborted = true;
                reject(new Error("Request aborted"));
              }, { once: true });
              stalled();
            });
            return stage === "headers" ? hang() : { status: 200, ok: true, text: hang };
          }
          if (requestPath === "/api/auth/dingtalk/config") return Response.json({ corpId: "test-corp" });
          if (requestPath === "/api/auth/dingtalk") return Response.json({ token: "fresh-session" });
          if (requestPath === "/api/auth/me") return Response.json({ employee: { employeeNo: "T001" }, access: { accessLevel: "HQ" } });
          if (requestPath.startsWith("/api/dashboard-summary")) return Response.json({ areaRows: [] });
          throw new Error("Unexpected request: " + requestPath);
        },
      });
      await pendingRequest;
      timers.advance(14999);
      assert.equal(page.document.body.innerHTML, "");
      timers.advance(1);
      await settles(page.startup);
      assert.equal(aborted, true);
      assert.match(page.document.body.innerHTML, /id="loginForm"/);
      assert.match(page.run("state.dingtalk.error"), /timed out.*try again/i);
      assert.equal(page.bodyClasses.has("auth-loading"), false);
      assert.equal(page.run("state.loginInProgress"), false);
      assert.equal(page.storage.has("csd_token"), false);
      shouldStall = false;
      await page.run("loginWithDingTalk()");
      assert.match(page.document.body.innerHTML, /class="app-shell"/);
      assert.equal(page.run("state.token"), "fresh-session");
    });
  }
}

test("a stalled stored-session check times out and recovers with DingTalk SSO", async () => {
  const timers = createClock();
  let meCalls = 0;
  const page = createPage({
    storedToken: "old-session", userAgent: "DingTalk", timers,
    dd: { runtime: { permission: { requestAuthCode: (options) => options.onSuccess({ code: "test-code" }) } } },
    fetch: async (path, options) => {
      if (path === "/api/auth/me") {
        if (++meCalls === 1) return new Promise((resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(new Error("Request aborted")), { once: true });
        });
        return Response.json({ employee: { employeeNo: "T001" }, access: { accessLevel: "HQ" } });
      }
      if (path === "/api/auth/dingtalk/config") return Response.json({ corpId: "test-corp" });
      if (path === "/api/auth/dingtalk") return Response.json({ token: "recovered-session" });
      if (path.startsWith("/api/dashboard-summary")) return Response.json({ areaRows: [] });
      throw new Error("Unexpected request: " + path);
    },
  });
  timers.advance(15000);
  await settles(page.startup);
  assert.match(page.document.body.innerHTML, /class="app-shell"/);
  assert.equal(page.run("state.token"), "recovered-session");
  assert.equal(page.renders.some((html) => html.includes('id="loginForm"')), false);
});

test("completed authentication requests clear their deadlines", async () => {
  const timers = createClock();
  let signal;
  const page = createPage({ timers, fetch: async (path, options) => {
    signal = options.signal;
    return Response.json({ corpId: "test-corp" });
  } });
  await page.startup;
  await page.run('api("/api/auth/dingtalk/config")');
  timers.advance(15000);
  assert.equal(signal.aborted, false);
});

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

test("opening DingTalk with an expired stored session automatically signs in again", async () => {
  const paths = [];
  let meCalls = 0;
  const page = createPage({
    storedToken: "expired-session",
    userAgent: "DingTalk",
    dd: { runtime: { permission: { requestAuthCode: (options) => options.onSuccess({ code: "fresh-code" }) } } },
    fetch: async (path) => {
      paths.push(path);
      if (path === "/api/auth/me") {
        meCalls += 1;
        if (meCalls === 1) return Response.json({ error: "Authentication required" }, { status: 401 });
        return Response.json({ employee: { employeeNo: "T001" }, access: { accessLevel: "HQ" } });
      }
      if (path === "/api/auth/dingtalk/config") return Response.json({ corpId: "test-corp" });
      if (path === "/api/auth/dingtalk") return Response.json({ token: "fresh-session" });
      if (path.startsWith("/api/dashboard-summary")) return Response.json({ areaRows: [] });
      throw new Error("Unexpected request: " + path);
    },
  });
  await page.startup;
  assert.equal(page.run("state.token"), "fresh-session");
  assert.equal(page.storage.get("csd_token"), "fresh-session");
  assert.equal(paths.filter((path) => path === "/api/auth/dingtalk").length, 1);
  assert.equal(paths.includes("/api/auth/login"), false);
  assert.match(page.document.body.innerHTML, /class="app-shell"/);
});

test("automatic SSO waits for a slow SDK instead of giving up after two seconds", async () => {
  let polls = 0;
  let logins = 0;
  const page = createPage({ fetch: async (path) => {
    if (path === "/api/auth/dingtalk/config") return Response.json({ corpId: "test-corp" });
    if (path === "/api/auth/dingtalk") { logins += 1; return Response.json({ token: "fresh-session" }); }
    if (path === "/api/auth/me") return Response.json({ employee: { employeeNo: "T001" }, access: { accessLevel: "HQ" } });
    if (path.startsWith("/api/dashboard-summary")) return Response.json({ areaRows: [] });
    throw new Error("Unexpected request: " + path);
  } });
  page.context.setTimeout = (callback, delay) => {
    if (delay !== 100) return setTimeout(callback, delay);
    polls += 1;
    if (polls === 25) {
      page.context.window.dd = { runtime: { permission: { requestAuthCode: (options) => options.onSuccess({ code: "slow-sdk-code" }) } } };
    }
    queueMicrotask(callback);
    return 0;
  };
  await page.run("autoLoginWithDingTalk()");
  assert.equal(logins, 1);
  assert.equal(page.run("state.token"), "fresh-session");
  assert.equal(page.run("state.dingtalk.error"), "");
});

test("a valid stored session is reused without requesting a new DingTalk code", async () => {
  const paths = [];
  const page = createPage({ storedToken: "valid-session", userAgent: "DingTalk", fetch: async (path) => {
    paths.push(path);
    if (path === "/api/auth/me") return Response.json({ employee: { employeeNo: "T001" }, access: { accessLevel: "HQ" } });
    if (path.startsWith("/api/dashboard-summary")) return Response.json({ areaRows: [] });
    throw new Error("Unexpected request: " + path);
  } });
  await page.startup;
  assert.equal(page.run("state.token"), "valid-session");
  assert.equal(paths.includes("/api/auth/dingtalk/config"), false);
  assert.match(page.document.body.innerHTML, /class="app-shell"/);
});

test("an expired session in an ordinary browser leaves password login available", async () => {
  const paths = [];
  const page = createPage({ storedToken: "expired-session", fetch: async (path) => {
    paths.push(path);
    return Response.json({ error: "Authentication required" }, { status: 401 });
  } });
  page.context.window.navigator.userAgent = "Browser";
  await page.startup;
  assert.equal(page.run("state.token"), "");
  assert.deepEqual(paths, ["/api/auth/me"]);
  assert.match(page.document.body.innerHTML, /id="loginForm"/);
});

test("explicit logout does not immediately sign the user back in through SSO", async () => {
  const paths = [];
  const page = createPage({ fetch: async (path) => {
    paths.push(path);
    return Response.json({ success: true });
  } });
  page.run('state.token = "active-session"; sessionStorage.setItem("csd_token", "active-session")');
  await page.run("logout()");
  assert.deepEqual(paths, ["/api/auth/logout"]);
  assert.equal(page.run("state.token"), "");
  assert.match(page.document.body.innerHTML, /id="loginForm"/);
});

test("explicit logout cancels automatic recovery of an in-flight startup session check", async () => {
  const paths = [];
  let rejectStartup;
  let meCalls = 0;
  const page = createPage({
    storedToken: "old-session", userAgent: "DingTalk",
    dd: { runtime: { permission: { requestAuthCode: (options) => options.onSuccess({ code: "fresh-code" }) } } },
    fetch: async (path) => {
      paths.push(path);
      if (path === "/api/auth/me") {
        if (++meCalls === 1) return new Promise((_, reject) => { rejectStartup = reject; });
        return Response.json({ employee: { employeeNo: "T001" }, access: { accessLevel: "HQ" } });
      }
      if (path === "/api/auth/logout") return Response.json({ success: true });
      if (path === "/api/auth/dingtalk/config") return Response.json({ corpId: "test-corp" });
      if (path === "/api/auth/dingtalk") return Response.json({ token: "fresh-session" });
      if (path.startsWith("/api/dashboard-summary")) return Response.json({ areaRows: [] });
      throw new Error("Unexpected request: " + path);
    },
  });
  await page.run("logout()");
  rejectStartup(new Error("Startup session check failed"));
  assert.match(page.document.body.innerHTML, /id="loginForm"/);
  assert.equal(page.bodyClasses.has("auth-loading"), false);
  await page.startup;
  assert.equal(page.run("state.token"), "");
  assert.equal(paths.includes("/api/auth/dingtalk/config"), false);
});

test("explicit logout cancels automatic SSO while waiting for the SDK", async () => {
  const paths = [];
  let releasePoll;
  const page = createPage({ fetch: async (path) => {
    paths.push(path);
    throw new Error("Automatic login must be cancelled");
  } });
  page.context.setTimeout = (callback) => { releasePoll = callback; return 0; };
  const automaticLogin = page.run("autoLoginWithDingTalk()");
  await page.run("logout()");
  releasePoll();
  await automaticLogin;
  assert.deepEqual(paths, []);
  assert.equal(page.run("state.dingtalk.error"), "");
});

test("manual DingTalk sign-in remains available after explicit logout", async () => {
  const page = createPage({
    dd: { runtime: { permission: { requestAuthCode: (options) => options.onSuccess({ code: "manual-code" }) } } },
    fetch: async (path) => {
      if (path === "/api/auth/dingtalk/config") return Response.json({ corpId: "test-corp" });
      if (path === "/api/auth/dingtalk") return Response.json({ token: "manual-session" });
      if (path === "/api/auth/me") return Response.json({ employee: { employeeNo: "T001" }, access: { accessLevel: "HQ" } });
      if (path.startsWith("/api/dashboard-summary")) return Response.json({ areaRows: [] });
      throw new Error("Unexpected request: " + path);
    },
  });
  await page.run("logout()");
  await page.run("loginWithDingTalk()");
  assert.equal(page.run("state.token"), "manual-session");
  assert.equal(page.storage.get("csd_token"), "manual-session");
});
