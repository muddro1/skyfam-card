// Usage: node shoot.js <outdir> [w] [h] [views...]
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const out = process.argv[2] || "shots";
const W = Number(process.argv[3] || 1280), H = Number(process.argv[4] || 800);
const views = process.argv.slice(5).length ? process.argv.slice(5) : ["today", "planner", "week", "month", "chores", "lists"];
fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": p.endsWith(".js") ? "text/javascript" : "text/html" });
  fs.createReadStream(p).pipe(res);
}).listen(8765, async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  // FAKE_TIME="2026-11-03T15:30:00" pins the clock; DARK=1 starts in dark mode
  if (process.env.FAKE_TIME && page.clock) await page.clock.install({ time: new Date(process.env.FAKE_TIME) });
  if (process.env.DARK) await page.addInitScript(() => localStorage.setItem("skyfam:theme", JSON.stringify("dark")));
  const logs = [];
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  for (const v of views) {
    await page.goto(`http://localhost:8765/test/harness.html?view=${v}`);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/${v}-${W}x${H}.png` });
  }
  // interaction test: tick a chore, open add-event, open an event
  await page.goto(`http://localhost:8765/test/harness.html?view=chores`);
  await page.waitForTimeout(500);
  const card = page.locator("skyfam-card");
  await card.locator(".chore:not(.done)").first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/chores-after-tick-${W}x${H}.png` });
  await page.goto(`http://localhost:8765/test/harness.html?view=week`);
  await page.waitForTimeout(500);
  await card.locator(".fab").click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/add-event-${W}x${H}.png` });
  await card.locator("[data-act=close]").click();
  await card.locator(".pill").first().click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/event-modal-${W}x${H}.png` });
  console.log(logs.filter((l) => !l.includes("SKYFAM")).join("\n"));
  await browser.close();
  srv.close();
});
