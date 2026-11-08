// Chores: drag a chore by its grip to reorder it. Run: node reorder-test.js shots-ro
const { chromium } = require("playwright"); const http = require("http"), fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, ".."); const out = process.argv[2] || "shots-ro"; fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split("?")[0])); r.writeHead(200, { "Content-Type": (p.endsWith(".js") ? "text/javascript" : p.endsWith(".svg") ? "image/svg+xml" : "text/html") + "; charset=utf-8" }); fs.createReadStream(p).pipe(r); }).listen(8777, async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const logs = []; pg.on("console", (m) => logs.push(m.text())); pg.on("pageerror", (e) => logs.push("PAGEERROR " + e.message));
  const c = () => pg.locator("skyfam-card");
  const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) process.exitCode = 1; };
  const moves = () => logs.filter((l) => l.startsWith("WS ")).map((l) => JSON.parse(l.slice(3))).filter((m) => m.type === "todo/item/move");
  const mia = () => c().locator(".kid:has-text('Mia')");
  const order = (per) => mia().locator(`.per:has-text('${per}') .chore`).evaluateAll((els) => els.map((e) => e.dataset.uid).join());
  const drag = async (from, to, below) => {
    const g = await mia().locator(`[data-uid=${from}] [data-grip]`).boundingBox(), t = await mia().locator(`[data-uid=${to}]`).boundingBox();
    await pg.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await pg.mouse.down();
    await pg.mouse.move(g.x + 5, t.y + (below ? t.height - 6 : 6), { steps: 8 }); await pg.mouse.up(); await pg.waitForTimeout(300);
  };
  await pg.goto("http://localhost:8777/test/harness.html"); await pg.waitForTimeout(600);
  await c().locator(".rail [data-v=chores]").click(); await pg.waitForTimeout(200);
  ok((await mia().locator("[data-grip]").count()) === 0, "no grips outside edit mode");
  await c().locator("[data-act=chore-edit]").click(); await pg.waitForTimeout(200);
  if (await c().locator(".modal input").count()) { console.log("PIN asked; test needs no PIN"); process.exitCode = 1; }
  ok((await order("Morning")) === "c1,c2,c3", "starting order");

  await drag("c3", "c1", false);
  ok((await order("Morning")) === "c3,c1,c2", "moved to the top: " + await order("Morning"));
  ok(moves().length === 1 && moves()[0].uid === "c3" && !("previous_uid" in moves()[0]), "first in list sends no previous_uid");
  ok((await c().locator(".modal").count()) === 0 || !(await c().locator(".modal").innerText()).includes("Edit chore"), "dragging doesn't open the chore form");
  await pg.screenshot({ path: `${out}/1-moved.png` });

  await drag("c3", "c2", true);
  ok((await order("Morning")) === "c1,c2,c3", "moved to the bottom: " + await order("Morning"));
  ok(moves()[1].previous_uid === "c2", "previous_uid is the chore above");

  await drag("c4", "c5", true);
  ok((await order("Evening")) === "c5,c4", "evening reorder: " + await order("Evening"));
  ok(moves()[2].previous_uid === "c5", "evening previous_uid");

  await mia().locator("[data-uid=c1]").click(); await pg.waitForTimeout(200);
  ok((await c().locator(".modal").innerText()).includes("Edit chore"), "tapping a chore still opens the form");
  logs.filter((l) => l.startsWith("PAGEERROR")).forEach((l) => { console.log(l); process.exitCode = 1; });
  await b.close(); srv.close();
});
