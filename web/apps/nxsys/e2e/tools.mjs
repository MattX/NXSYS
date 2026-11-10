// Phase 5 e2e: relay query/state, tracer, drafter, full signal windows, context menu, preferences, message boxes.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = resolve(appDir, "screenshots");
mkdirSync(shots, { recursive: true });
const PORT = 4180;
const URL = `http://localhost:${PORT}/`;
let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
};
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: appDir, stdio: "ignore" });
const kill = () => server.kill();
process.on("exit", kill);
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(URL)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const exe = ["/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", "/opt/pw-browsers/chromium"].find(existsSync);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => m.type() === "error" && pageErrors.push(m.text()));
page.on("dialog", (d) => { pageErrors.push("BLOCKING DIALOG " + d.message()); d.dismiss(); });

const relay = (n) => page.evaluate((n) => window.__nxsys.debug.relay(n), n);
const advance = (ms) => page.evaluate((ms) => window.__nxsys.debug.advance(ms), ms);
const pointOf = (type, nom) => page.evaluate(({ type, nom }) => {
  const c = window.__nxsys.debug.center(type, nom);
  if (!c) return null;
  const sc = document.querySelector("[data-testid=panel]");
  const z = parseFloat(document.querySelector("[data-testid=zoom]").textContent) / 100;
  sc.scrollLeft = c.x * z - sc.clientWidth / 2; sc.scrollTop = c.y * z - sc.clientHeight / 2;
  const r = sc.getBoundingClientRect();
  return { x: r.left + c.x * z - sc.scrollLeft, y: r.top + c.y * z - sc.scrollTop };
}, { type, nom });
const menu = async (top, item) => { await page.click(`button.tb:has-text('${top}')`); await page.click(`button.mi:has-text('${item}')`); };
const canvasHash = (sel) => page.evaluate((sel) => {
  const c = document.querySelector(sel); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let h = 0; for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0; return h;
}, sel);

/** park every tool window at the bottom edge so they do not cover the panel objects we click */
const stash = () => page.evaluate(() => { const t = window.__tools; for (const w of t.getSnapshot().wins) t.move(w.id, w.x, 765); });
const unstash = (kind, x, y) => page.evaluate(({ kind, x, y }) => { const t = window.__tools; for (const w of t.getSnapshot().wins) if (w.kind === kind) t.move(w.id, x, y); }, { kind, x, y });
try {
  await page.goto(URL);
  await page.waitForFunction(() => { const s = window.__nxsys?.getSnapshot(); return s && s.loaded && !s.loading; }, null, { timeout: 20000 });

  // --- query a relay by name
  await menu("Relays", "Query relay");
  await page.fill("[data-testid=relay-input]", "nosuchrelay");
  await page.press("[data-testid=relay-input]", "Enter");
  check("bad relay name rejected inline", (await page.textContent("[data-testid=relay-prompt]")).includes("No such relay"));
  await page.fill("[data-testid=relay-input]", "4h");
  await page.press("[data-testid=relay-input]", "Enter");
  await page.waitForSelector("[data-testid=win-relaystate]");
  check("relay state window names the relay", (await page.textContent("[data-testid=rs-name]")) === "Relay 4H");
  check("relay 4H is DROPPED", (await page.textContent("[data-testid=rs-state]")).includes("DROPPED"));
  check("dependents listed", (await page.locator("[data-testid=rs-deps] .rs-row").count()) > 0);
  await page.screenshot({ path: `${shots}/10-relay-state.png` });

  // --- tracer
  await menu("Relays", "Trace to window");
  await page.waitForSelector("[data-testid=win-tracer]");

  // --- drafter: draw 4H from the state window
  // the tracer window may overlap it: bring the relay-state window to the front first, as a user would
  await page.click("[data-testid=win-relaystate] .fwin-title", { position: { x: 8, y: 8 } });
  await page.click("[data-testid=win-relaystate] button:has-text('Draw')");
  await page.waitForSelector("[data-testid=drafter-canvas]");
  const h0 = await canvasHash("[data-testid=drafter-canvas]");

  // --- set a route (as smoke.mjs): switch 9, signal 4 -> 20
  await stash();
  const sw = await pointOf("TURNOUT", 9);
  await page.mouse.click(sw.x, sw.y, { button: "right" });
  await advance(4000);
  const sig = await pointOf("SIGNAL", 4);
  await page.mouse.click(sig.x, sig.y);
  await advance(500);
  const ex = await pointOf("SIGNAL", 20);
  await page.mouse.click(ex.x, ex.y);
  await advance(8000);
  check("route set (4H picks)", (await relay("4H")) === true);
  await page.waitForTimeout(400);
  await unstash("tracer", 700, 420);
  await unstash("drafter", 16, 60);
  await unstash("relaystate", 980, 70);
  const log = await page.textContent("[data-testid=trace-log]");
  check("tracer logged transitions", /4H\s+PICK/.test(log) && /9RWZ/.test(log), log.slice(-120));
  await page.fill("[data-testid=trace-filter]", "4H");
  await page.waitForTimeout(300);
  const flog = await page.textContent("[data-testid=trace-log]");
  check("tracer filter works", flog.includes("4H") && !flog.includes("9RWZ"));
  await page.fill("[data-testid=trace-filter]", "");
  const h1 = await canvasHash("[data-testid=drafter-canvas]");
  check("drafter contacts change with relay state", h0 !== h1);
  check("state window follows the relay", (await page.textContent("[data-testid=rs-state]")).includes("PICKED"));
  await page.screenshot({ path: `${shots}/11-drafter-tracer.png` });

  // --- full signal display: plain right click on a signal
  await stash();
  await page.mouse.click(sig.x, sig.y, { button: "right" });
  await page.waitForSelector("[data-testid=win-fullsig]");
  check("right-click signal opens a full signal window", true);
  const fsw = await canvasHash("[data-testid=fullsig-canvas]");
  await page.screenshot({ path: `${shots}/12-fullsig.png` });

  // --- context menu: control + right click
  await page.keyboard.down("Control");
  await page.mouse.click(sig.x, sig.y, { button: "right" });
  await page.keyboard.up("Control");
  await page.waitForSelector("[data-testid=ctxmenu]");
  const items = await page.locator("[data-testid=ctxmenu] button").allTextContents();
  check("signal context menu items", items.includes("Show Full Signal") && items.includes("Cancel") && items.includes("Query Relay"), items.join("|"));
  check("Cancel enabled, Initiate disabled for an initiated signal",
    (await page.locator("[data-testid=ctxmenu] [data-cmd=INITIATE]").isDisabled()) && !(await page.locator("[data-testid=ctxmenu] [data-cmd=CANCEL]").isDisabled()));
  await page.screenshot({ path: `${shots}/13-contextmenu.png` });
  await page.click("[data-testid=ctxmenu] [data-cmd=QUERY]");
  await page.waitForSelector("[data-testid=selector-list]");
  check("Query Relay lists the signal's relays", (await page.locator("[data-testid=selector-list] .rs-row").count()) > 3);
  await page.locator("[data-testid=selector-list] .rs-row", { hasText: /^PBS$/ }).dblclick();
  await page.waitForTimeout(200);
  check("choosing a relay shows its state", (await page.textContent("[data-testid=rs-name]")).startsWith("Relay 4PBS"));
  // Cancel the route through the menu
  await page.keyboard.down("Control");
  await page.mouse.click(sig.x, sig.y, { button: "right" });
  await page.keyboard.up("Control");
  await page.click("[data-testid=ctxmenu] [data-cmd=CANCEL]");
  await advance(8000);
  check("context-menu Cancel drops the signal", (await relay("4H")) === false);
  const fsw2 = await canvasHash("[data-testid=fullsig-canvas]");
  check("full signal window updates live", fsw !== fsw2);

  // --- switch context menu
  await page.keyboard.down("Control");
  await page.mouse.click(sw.x, sw.y, { button: "right" });
  await page.keyboard.up("Control");
  const sitems = await page.locator("[data-testid=ctxmenu] button").allTextContents();
  check("switch context menu", sitems.includes("Call Normal") && sitems.includes("Query relay..."), sitems.join("|"));
  const wasReverse = await relay("9RWP");
  const cmd = wasReverse ? "NORMAL" : "REVERSE";
  check("menu enables only the opposite call (" + cmd + ")", !(await page.locator(`[data-testid=ctxmenu] [data-cmd=${cmd}]`).isDisabled()) && (await page.locator(`[data-testid=ctxmenu] [data-cmd=${wasReverse ? "REVERSE" : "NORMAL"}]`).isDisabled()), "9RWP=" + wasReverse);
  await page.click(`[data-testid=ctxmenu] [data-cmd=${cmd}]`);
  await advance(4000);
  check("menu call drives the switch", (await relay(wasReverse ? "9NWP" : "9RWP")) === true);

  // --- relay list
  await menu("Relays", "Relay list");
  await page.fill("[data-testid=rl-filter]", "9RW");
  await page.waitForTimeout(300);
  check("relay list filters", (await page.locator(".rl-row").count()) > 0);
  await page.screenshot({ path: `${shots}/14-relaylist.png` });

  // --- file info
  await menu("File", "File info");
  const st = await page.textContent("[data-testid=status-text]");
  check("file info report", /relays \(non-stub\)/.test(st) && /signals \(total\)/.test(st), st.slice(0, 80));

  // --- preferences persist and take effect
  await menu("File", "Preferences");
  await page.check("input[name=rc] >> nth=1");
  await page.click("[data-testid=prefs-ok]");
  check("preference persisted", await page.evaluate(() => JSON.parse(localStorage.getItem("nxsys.preferences")).signalRightIsMenu === true));
  await page.mouse.click(sig.x, sig.y, { button: "right" });
  check("right-click on a signal now opens the menu", await page.locator("[data-testid=ctxmenu]").isVisible());
  await page.keyboard.press("Escape");

  // --- non-blocking message box
  await page.evaluate(() => window.__tools.drawRelayByName("999ZZ"));
  await page.waitForSelector("[data-testid=msgbox]");
  check("ok message box is in-app and non-blocking", (await page.textContent("[data-testid=msgbox]")).includes("No such relay"));
  await page.click("[data-testid=msgbox] button");
  check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  await browser.close();
  kill();
}
console.log(failures ? `${failures} FAILED` : "all ok");
process.exit(failures ? 1 : 0);
