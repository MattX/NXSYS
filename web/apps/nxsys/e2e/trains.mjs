// Trains e2e: create a train through the Trains menu, route it, watch it move, screenshot the panels.
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
const PORT = 4183;
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

const relay = (n) => page.evaluate((n) => window.__nxsys.debug.relay(n), n);
const advance = (ms) => page.evaluate((ms) => window.__nxsys.debug.advance(ms), ms);
const text = (id) => page.locator(`[data-testid=${id}]`).innerText();
const pointOf = (type, nom) => page.evaluate(({ type, nom }) => {
  const c = window.__nxsys.debug.center(type, nom);
  if (!c) return null;
  const sc = document.querySelector("[data-testid=panel]");
  const z = parseFloat(document.querySelector("[data-testid=zoom]").textContent) / 100;
  sc.scrollLeft = c.x * z - sc.clientWidth / 2; sc.scrollTop = c.y * z - sc.clientHeight / 2;
  const r = sc.getBoundingClientRect();
  return { x: r.left + c.x * z - sc.scrollLeft, y: r.top + c.y * z - sc.scrollTop };
}, { type, nom });
const menu = async (label) => page.getByRole("button", { name: new RegExp("^" + label) }).first().click();

try {
  await page.goto(URL);
  await page.waitForFunction(() => { const s = window.__nxsys?.getSnapshot(); return s && s.loaded && !s.loading; }, null, { timeout: 20000 });
  await page.evaluate(() => window.__nxsys.setRunning(false));

  // Trains menu replaces the placeholder
  await menu("Trains");
  check("Trains menu lists New / Kill all", (await page.locator("[data-testid=train-new]").count()) === 1 && (await page.locator("[data-testid=train-kill-all]").count()) === 1);
  check("entry points are offered", (await page.locator("[data-testid^=train-entry-]").count()) >= 4);
  await page.locator("[data-testid=train-new]").click();
  check("placement prompt shown", (await page.locator("[data-testid=train-offer]").count()) === 1);

  // place the train on the south end of track 2 (IJ 2693) by clicking the track section
  const t0 = await pointOf("TRACKSEC", 2693);
  await page.mouse.click(t0.x, t0.y);
  await page.waitForSelector("[data-testid=train-1]", { timeout: 3000 });
  check("train panel appears", true);
  check("track 2693 occupied by the train", (await relay("2693T")) === false);
  check("panel shows location", /A2-693/.test(await text("train-1-loc")), await text("train-1-loc"));
  check("placement prompt gone", (await page.locator("[data-testid=train-offer]").count()) === 0);

  // line a route ahead of it: signal 2 clears the block into 2700
  const sg = await pointOf("SIGNAL", 2);
  await page.mouse.click(sg.x, sg.y);
  await advance(3000);
  check("signal 2 cleared", (await relay("2H")) === true);
  await advance(1000);
  check("next-signal readout names signal 4's neighbour", (await text("train-1-next")).length > 0, await text("train-1-next"));
  const before = await text("train-1-loc");
  await advance(14000);
  check("train moved into 2700 (T relay dropped)", (await relay("2700T")) === false);
  check("route released behind: signal 2 H dropped", (await relay("2H")) === false);
  await advance(24000);
  check("tail vacated 2693 (T relay picked)", (await relay("2693T")) === true);
  const after = await text("train-1-loc");
  check("location readout updates live", before !== after, `${before} -> ${after}`);
  check("speed readout", /^\d+\/75$/.test(await text("train-1-speed")), await text("train-1-speed"));
  await page.screenshot({ path: `${shots}/05-trains.png` });

  // panel controls
  await page.locator("[data-testid=train-1-halt]").click();
  check("halt stops the train", (await text("train-1-speed")).startsWith("0/"), await text("train-1-speed"));
  check("halt switches to free will", await page.locator("[data-testid=train-1-freewill]").isChecked());
  await page.locator("[data-testid=train-1-slider]").fill("50");
  check("slider sets speed", /^37\/75$/.test(await text("train-1-speed")), await text("train-1-speed"));
  await page.screenshot({ path: `${shots}/06-train-panel.png` });
  await page.locator("[data-testid=train-1-kill]").click();
  check("kill removes the panel", (await page.locator("[data-testid=train-1]").count()) === 0);
  check("kill frees the track circuit", (await relay("2700T")) === true);

  // a second train via the entry-point shortcut, then Kill all
  await menu("Trains");
  await page.locator("[data-testid=train-entry-3693]").click();
  await page.waitForSelector("[data-testid=train-1]", { timeout: 3000 });
  check("entry-point shortcut creates a train (number reused)", true);
  await menu("Trains \\(1\\)");
  await page.locator("[data-testid=train-kill-all]").click();
  check("Kill all removes trains", (await page.locator("[data-testid^=train-1]").count()) === 0 && (await relay("3700T")) === true);

  // a bundled-style demo with trains runs in the app
  await page.evaluate(() => window.__nxsys.setRunning(true));
  check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  await browser.close();
  kill();
}
console.log(failures ? `${failures} FAILED` : "all ok");
process.exit(failures ? 1 : 0);
