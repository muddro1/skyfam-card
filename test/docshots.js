// Regenerates the README screenshots in docs/ with the clock pinned to Tue Nov 3, 3:30pm. Run: npm run docs
const { chromium } = require("playwright"); const http = require("http"), fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, ".."), out = path.join(root, "docs");
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": (p.endsWith(".js") ? "text/javascript" : p.endsWith(".svg") ? "image/svg+xml" : "text/html") + "; charset=utf-8" }); fs.createReadStream(p).pipe(r); }).listen(8790, async () => {
  const b = await chromium.launch(); const errs = [];
  const open = async (view, w, h, dark) => {
    const pg = await b.newPage({ viewport: { width: w, height: h } });
    await pg.clock.install({ time: new Date("2026-11-03T15:30:00") });
    if (dark) await pg.addInitScript(() => localStorage.setItem("skyfam:theme", JSON.stringify("dark")));
    pg.on("pageerror", (e) => errs.push(e.message));
    await pg.goto(`http://localhost:8790/test/harness.html?view=${view}`); await pg.waitForTimeout(800); return pg;
  };
  const shot = async (pg) => { await pg.waitForTimeout(350); const buf = await pg.screenshot(); return buf; };
  const c = (pg) => pg.locator("skyfam-card");
  for (const v of ["today", "planner", "week", "month", "chores", "lists"]) { const pg = await open(v, 1280, 800); fs.writeFileSync(`${out}/${v}.png`, await shot(pg)); await pg.close(); }
  // grid of images: cols, cell width, cell height
  const grid = async (name, bufs, cols, w, h) => {
    const rows = Math.ceil(bufs.length / cols), W = cols * w + (cols - 1) * 10, H = rows * h + (rows - 1) * 10;
    const pg = await b.newPage({ viewport: { width: W, height: H } });
    await pg.setContent(`<body style="margin:0;background:#fff;display:grid;grid-template-columns:repeat(${cols},${w}px);gap:10px">${bufs.map((x) => `<img style="width:${w}px;height:${h}px;display:block" src="data:image/png;base64,${x.toString("base64")}">`).join("")}</body>`);
    await pg.waitForTimeout(200); await pg.screenshot({ path: `${out}/${name}.png` }); await pg.close();
  };
  const phone = []; for (const v of ["today", "week", "chores", "lists"]) { const pg = await open(v, 390, 844); phone.push(await shot(pg)); await pg.close(); }
  await grid("phone", phone, 4, 390, 844);
  const dark = []; for (const v of ["today", "planner", "week", "chores"]) { const pg = await open(v, 1280, 800, true); dark.push(await shot(pg)); await pg.close(); }
  await grid("dark", dark, 2, 640, 400);
  const ed = [];
  let pg = await open("chores", 1280, 800);
  await c(pg).locator(".chorebar [data-act=chore-add]").click(); ed.push(await shot(pg));
  await c(pg).locator("[data-act=close]").first().click();
  await c(pg).locator("[data-act=chore-edit]").click(); ed.push(await shot(pg));
  await c(pg).locator("[data-act=rewards-edit]").click(); ed.push(await shot(pg));
  await c(pg).locator("[data-act=reward-new]").click(); await c(pg).locator(".modal input:not(.emoji)").first().fill("Pizza night"); ed.push(await shot(pg));
  await pg.close();
  pg = await open("chores", 1280, 800);
  await c(pg).locator("[data-act=rewards]").first().click(); ed.push(await shot(pg));
  await pg.close();
  await grid("editing", [ed[0], ed[1], ed[2], ed[4]], 2, 640, 400);
  console.log(errs.length ? "PAGEERRORS " + errs.join("; ") : "ok");
  await b.close(); srv.close();
});
