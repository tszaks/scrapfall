// Account checks use only a local Vite server and intercepted fake backend responses.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
const port = 4174;
const url = `http://127.0.0.1:${port}/game/?map=vice&seed=7`;
const server = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  {
    env: {
      ...process.env,
      VITE_SUPABASE_URL: "https://accounts.scrapfall.test",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_mock",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("account test server did not start")), 30000);
  server.stdout.on("data", (chunk) => {
    if (String(chunk).includes("Local:")) {
      clearTimeout(timer);
      resolve();
    }
  });
  server.on("exit", (code) => {
    clearTimeout(timer);
    reject(new Error(`account test server exited ${code}`));
  });
});
let browser;
try {
  browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "player@scrapfall.local",
    user_metadata: { username: "player" },
    app_metadata: {},
    aud: "authenticated",
    created_at: "2026-10-01T00:00:00Z",
  };
  const profile = {
    id: user.id,
    username: "player",
    kills: 17,
    matches: 2,
    best_wave: 6,
    color: "#ffaa00",
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const token = `${encode({ alg: "HS256" })}.${encode({ sub: user.id, exp: expiry })}.mock`;
  const session = {
    access_token: token,
    refresh_token: "mock",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiry,
    user,
  };
  let reads = 0;
  await page.route("https://accounts.scrapfall.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/rest/v1/profiles")) {
      reads++;
      return route.fulfill({ json: profile });
    }
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/auth/v1/logout") return route.fulfill({ status: 204 });
    return route.fulfill({ status: 503, json: { message: "mock endpoint unavailable" } });
  });
  await page.goto(url);
  await page.getByRole("button", { name: "LOG IN", exact: true }).click();
  await page.getByRole("textbox", { name: "Username", exact: true }).fill("player");
  await page.getByLabel("Password", { exact: true }).fill("mock-password");
  await page.getByRole("dialog").getByRole("button", { name: "Log in", exact: true }).click();
  await page.getByText("TOTAL KILLS · 17", { exact: true }).waitFor();
  assert.equal(reads, 1, "one profile load on sign-in");
  await page.reload();
  await page.getByRole("button", { name: "PLAYER", exact: true }).click();
  await page.getByText("TOTAL KILLS · 17", { exact: true }).waitFor();
  assert.equal(reads, 2, "one restoration load on refresh");
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await page.getByLabel("Username", { exact: true }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "LOG IN", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS account /game/ sign-in, single read, refresh restoration, logout persistence (mock backend)",
  );
} finally {
  await browser?.close();
  server.kill();
}
