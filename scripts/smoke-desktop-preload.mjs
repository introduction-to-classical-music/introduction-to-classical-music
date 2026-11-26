#!/usr/bin/env node
/**
 * 桌面端 preload 冒烟测试（回归护栏）。
 *
 * 背景：0.1.2 打开 `sandbox: true` 后，preload 仍是 ESM（`import`），Electron 在沙箱
 * 渲染进程里只以 CommonJS 执行 preload，导致
 * `SyntaxError: Cannot use import statement outside a module`，
 * `window.desktopLauncher` 静默缺失，启动器所有按钮报 undefined。
 *
 * 本脚本用仓库自带的 Electron 起一个最小窗口，把 **真实构建产物**
 * （output/runtime/apps/desktop/preload-*.cjs）挂上去，断言 bridge 真的注入成功。
 *
 * 用法：
 *   npm run runtime:build
 *   node scripts/smoke-desktop-preload.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import electronPath from "electron";

const PRELOADS = ["preload-launcher.cjs", "preload-owner.cjs", "preload-site.cjs"];
const runtimeDesktopDir = path.resolve("output", "runtime", "apps", "desktop");

for (const name of PRELOADS) {
  const file = path.join(runtimeDesktopDir, name);
  if (!existsSync(file)) {
    console.error(`[smoke] missing built preload: ${file}\n         run: npm run runtime:build`);
    process.exit(1);
  }
  const source = readFileSync(file, "utf8");
  if (/^\s*import\s/m.test(source) || /from\s+["']electron["']/.test(source)) {
    console.error(`[smoke] ${name} still contains ESM syntax; sandboxed preload cannot load it`);
    process.exit(1);
  }
}

const workDir = mkdtempSync(path.join(os.tmpdir(), "icm-preload-smoke-"));
const resultPath = path.join(workDir, "result.json");
const probeHtml = path.join(workDir, "probe.html");
writeFileSync(probeHtml, "<!doctype html><html><body>probe</body></html>", "utf8");
const probeUrl = pathToFileURL(probeHtml).href;

const appEntry = path.join(workDir, "main.js");
writeFileSync(
  appEntry,
  `const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { writeFileSync } = require("node:fs");

const workDir = ${JSON.stringify(workDir)};
const resultPath = ${JSON.stringify(resultPath)};
const probeUrl = ${JSON.stringify(probeUrl)};
const preloads = ${JSON.stringify(PRELOADS.map((name) => path.join(runtimeDesktopDir, name)))};
const results = [];
const windows = [];
const flush = () => { try { writeFileSync(resultPath, JSON.stringify(results, null, 2), "utf8"); } catch {} };

async function probe(preloadPath) {
  const index = results.length;
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: preloadPath },
  });
  win.webContents.on("preload-error", (_e, p, err) => {
    results.push({ preload: path.basename(p), error: String((err && (err.message || err)) || "unknown") });
    flush();
  });
  await win.loadURL(probeUrl + "?probe=" + index);
  const exposed = await win.webContents.executeJavaScript("typeof window.desktopLauncher === 'object' && window.desktopLauncher !== null");
  const methods = await win.webContents.executeJavaScript("window.desktopLauncher ? Object.keys(window.desktopLauncher).length : 0");
  results.push({ preload: path.basename(preloadPath), exposed: Boolean(exposed), methodCount: Number(methods) });
  flush();
  windows.push(win);
}

app.whenReady().then(async () => {
  try {
    for (const p of preloads) await probe(p);
    results.push({ done: true, electron: process.versions.electron });
    windows.forEach((w) => { try { w.destroy(); } catch {} });
  } catch (error) {
    results.push({ fatal: String((error && (error.stack || error.message)) || error) });
  } finally {
    flush();
    app.quit();
  }
});
`,
  "utf8",
);

writeFileSync(
  path.join(workDir, "package.json"),
  JSON.stringify({ name: "icm-preload-smoke", version: "1.0.0", main: "main.js" }, null, 2),
  "utf8",
);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const exitCode = await new Promise((resolve) => {
  const child = spawn(electronPath, [workDir], { env, stdio: "ignore", windowsHide: true });
  const timer = setTimeout(() => {
    child.kill();
    resolve("timeout");
  }, 60_000);
  child.on("exit", (code) => {
    clearTimeout(timer);
    resolve(code);
  });
});

let results = [];
try {
  results = JSON.parse(readFileSync(resultPath, "utf8"));
} catch {
  results = [];
}

const expectedMethods = { "preload-launcher.cjs": 9, "preload-owner.cjs": 7, "preload-site.cjs": 1 };
const failures = [];
for (const name of PRELOADS) {
  const entry = results.find((row) => row.preload === name);
  if (!entry) failures.push(`${name}: probe missing`);
  else if (entry.error) failures.push(`${name}: ${entry.error}`);
  else if (!entry.exposed) failures.push(`${name}: bridge not exposed under sandbox:true`);
  else if (entry.methodCount !== expectedMethods[name]) {
    failures.push(`${name}: expected ${expectedMethods[name]} methods, got ${entry.methodCount}`);
  }
}

try {
  rmSync(workDir, { recursive: true, force: true });
} catch {}

if (failures.length) {
  console.error(`[smoke] FAILED (electron exit=${exitCode})`);
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(`[smoke] raw results: ${JSON.stringify(results)}`);
  process.exit(1);
}

console.log(`[smoke] OK — 3 个 preload 在 sandbox:true 下均注入成功 (electron ${process.env.npm_package_version ? "" : ""}${results.find((r) => r.electron)?.electron || ""})`.trim());
