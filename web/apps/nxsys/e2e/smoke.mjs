// Headless-browser smoke tests: serves the built app (vite preview) and drives it with Playwright.
// Uses the preinstalled Chromium (no `playwright install`). Run: npm run build && npm run e2e
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const shots = resolve(appDir, "screenshots");
mkdirSync(shots, { recursive: true });
const PORT = 4179;
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

const snap = () => page.evaluate(() => { const s = window.__nxsys.getSnapshot(); return { loaded: s.loaded, title: s.title, relayCount: s.relayCount, errors: s.errors, loading: s.loading }; });
const waitLoaded = async () => { await page.waitForFunction(() => { const s = window.__nxsys?.getSnapshot(); return s && s.loaded && !s.loading; }, null, { timeout: 20000 }); };
const relay = (n) => page.evaluate((n) => window.__nxsys.debug.relay(n), n);
const advance = (ms) => page.evaluate((ms) => window.__nxsys.debug.advance(ms), ms);
/** scroll the object to the middle of the view and return its client coordinates */
const pointOf = (type, nom) => page.evaluate(({ type, nom }) => {
  const c = window.__nxsys.debug.center(type, nom);
  if (!c) return null;
  const sc = document.querySelector("[data-testid=panel]");
  const z = parseFloat(document.querySelector("[data-testid=zoom]").textContent) / 100;
  sc.scrollLeft = c.x * z - sc.clientWidth / 2; sc.scrollTop = c.y * z - sc.clientHeight / 2;
  const r = sc.getBoundingClientRect();
  return { x: r.left + c.x * z - sc.scrollLeft, y: r.top + c.y * z - sc.scrollTop };
}, { type, nom });

try {
  await page.goto(URL);
  await waitLoaded();
  let s = await snap();
  check("Progman loads by default", /progman/i.test(s.title), s.title);
  check("relays created", s.relayCount > 500, String(s.relayCount));
  check("no load errors", s.errors.length === 0, s.errors.join("|"));
  await page.screenshot({ path: `${shots}/01-progman.png` });

  // pause toggle freezes the clock
  await page.click("[data-testid=runpause]");
  const t0 = await page.evaluate(() => window.__nxsys.now());
  await page.waitForTimeout(300);
  check("pause stops the clock", (await page.evaluate(() => window.__nxsys.now())) === t0);
  await page.click("[data-testid=runpause]");
  await page.waitForTimeout(400);
  check("run advances the clock", (await page.evaluate(() => window.__nxsys.now())) > t0);

  // right-click switch 9 -> switch relays move
  const sw = await pointOf("TURNOUT", 9);
  check("switch 9 found", !!sw);
  const before = await relay("9RWZ");
  await page.mouse.click(sw.x, sw.y, { button: "right" });
  await advance(100);
  check("right-click throws switch 9 (9RWZ picks)", before === false && (await relay("9RWZ")) === true, `before=${before}`);
  await advance(4000);
  check("switch 9 reverse complete (9RWP)", (await relay("9RWP")) === true);
  await page.screenshot({ path: `${shots}/02-switch.png` });

  // route: click entrance signal 4, then exit signal 20 (as the golden demo script does)
  const sig = await pointOf("SIGNAL", 4);
  check("signal 4 found", !!sig);
  const rgpBefore = await relay("4RGP");
  await page.mouse.click(sig.x, sig.y);
  await advance(500);
  const ex = await pointOf("SIGNAL", 20);
  check("exit signal 20 found", !!ex);
  await page.mouse.click(ex.x, ex.y);
  await advance(8000);
  check("route set: 4RGP drops, 4H (signal clear) picks", rgpBefore === true && (await relay("4RGP")) === false && (await relay("4H")) === true,
    `4RGP before=${rgpBefore} after=${await relay("4RGP")} 4H=${await relay("4H")}`);
  await page.waitForTimeout(300);
  const st = await page.textContent("[data-testid=status]");
  check("status line shows sim time past 0:10", /sim 0:(1\d|[2-5]\d)\./.test(st) || /sim [1-9]:/.test(st), st);
  await page.screenshot({ path: `${shots}/03-route.png` });

  // zoom buttons
  await page.click("button[aria-label='Zoom in']");
  check("zoom in", (await page.textContent("[data-testid=zoom]")) === "110%");

  // reload via picker: switch interlocking
  await page.selectOption("select[aria-label=Interlocking]", { label: "Myrtle Ave." });
  await waitLoaded();
  s = await snap();
  check("Myrtle loads from picker", /myrtle/i.test(s.title), s.title);
  check("Myrtle has a demo script listed", await page.evaluate(() => window.__nxsys.getSnapshot().demos.length > 0));

  // demo script from the Demo menu (Myrtle.xdo): caption appears, switches move on the sim clock
  await page.click("button:has-text('Demo')");
  await page.click("button.mi:has-text('Myrtle.xdo')");
  await advance(2500);
  check("demo shows caption", (await page.evaluate(() => window.__nxsys.getSnapshot().caption)) !== null);
  await advance(20000);
  check("demo ran (switch relay moved)", (await relay("157RWZ")) !== null);
  await page.evaluate(() => window.__nxsys.stopDemo());

  // open a local folder through the hidden directory input
  await page.setInputFiles("input[webkitdirectory]", resolve(appDir, "../../../Interlockings/Atlantic"));
  await waitLoaded();
  s = await snap();
  check("local folder (Atlantic) loads via file input", /atlantic/i.test(s.title), s.title);

  // contextmenu is suppressed on the canvas
  const prevented = await page.evaluate(() => {
    const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    document.querySelector("[data-testid=canvas]").dispatchEvent(e);
    return e.defaultPrevented;
  });
  check("context menu suppressed", prevented);

  // phone width: no horizontal page scroll
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(200);
  check("no horizontal page scroll at phone width", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: `${shots}/04-phone.png` });
  check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  await browser.close();
  kill();
}
console.log(failures ? `${failures} FAILED` : "all ok");
process.exit(failures ? 1 : 0);
