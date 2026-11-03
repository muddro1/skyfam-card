// "Show on Today": stacked lists, item limit with "+ more", and the editor switch.
const { chromium } = require("playwright"); const http = require("http"), fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, ".."); const out = process.argv[2] || "shots-today-lists"; fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split("?")[0])); r.writeHead(200, { "Content-Type": (p.endsWith(".js") ? "text/javascript" : p.endsWith(".svg") ? "image/svg+xml" : "text/html") + "; charset=utf-8" }); fs.createReadStream(p).pipe(r); }).listen(8770, async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const logs = []; pg.on("console", (m) => logs.push(m.text())); pg.on("pageerror", (e) => logs.push("PAGEERROR " + e.message));
  const ok = (cond, msg) => console.log((cond ? "PASS " : "FAIL ") + msg);
  const c = () => pg.locator("skyfam-card");
  await pg.goto("http://localhost:8770/test/harness.html?view=today"); await pg.waitForTimeout(600);
  ok((await c().locator(".lists-col .card").count()) === 1, "default: only the first list on Today");
  await pg.evaluate(() => { const cfg = JSON.parse(JSON.stringify(window.card._config)); cfg.lists = cfg.lists.map((l) => ({ ...l, today: true })); cfg.today_list_items = 2; window.card.setConfig(cfg); });
  await pg.waitForTimeout(400); await pg.screenshot({ path: `${out}/1-stacked.png` });
  ok((await c().locator(".lists-col .card").count()) === 2, "two lists stacked");
  ok((await c().locator(".lists-col .card").first().locator(".todo").count()) === 2, "Home capped at 2 items");
  ok((await c().locator(".lists-col .card").first().locator("text=+ 1 more").count()) === 1, "'+ 1 more' link shown");
  await c().locator(".lists-col .card").nth(1).locator("input.add").fill("Pick up dry cleaning"); await c().locator(".lists-col .card").nth(1).locator("input.add").press("Enter");
  await pg.waitForTimeout(200);
  ok(logs.some((l) => l.includes("SERVICE todo add_item") && l.includes("todo.alex")), "adding from the second stacked list works");
  await c().locator(".lists-col .card").first().locator("text=+ 1 more").click(); await pg.waitForTimeout(200);
  ok((await c().locator(".nav.on").textContent()).includes("Lists"), "'+ more' opens the Lists tab");
  // only the second list flagged
  await pg.evaluate(() => { const cfg = JSON.parse(JSON.stringify(window.card._config)); cfg.lists = cfg.lists.map((l, i) => ({ ...l, today: i === 1 })); cfg.default_view = "today"; window.card.setConfig(cfg); });
  await c().locator(".nav[data-v=today]").click(); await pg.waitForTimeout(300);
  ok((await c().locator(".lists-col .card h2").textContent()).includes("Alex"), "a single flagged list replaces the default");
  await pg.setViewportSize({ width: 390, height: 844 }); await pg.evaluate(() => { const cfg = JSON.parse(JSON.stringify(window.card._config)); cfg.lists = cfg.lists.map((l) => ({ ...l, today: true })); window.card.setConfig(cfg); });
  await pg.waitForTimeout(400); await c().locator(".lists-col").scrollIntoViewIfNeeded(); await pg.screenshot({ path: `${out}/2-phone.png` });
  // editor switch
  await pg.goto("http://localhost:8770/test/editor.html"); await pg.waitForTimeout(600);
  const ed = () => pg.locator("skyfam-card-editor");
  await ed().locator('details[data-sec="lists"] > summary').click();
  await ed().locator('details[data-sec="lists-1"] > summary').click();
  await ed().locator('[data-slot="lists-1"] input[name=today]').check();
  const cfg = await pg.evaluate(() => window.__configs[window.__configs.length - 1]);
  ok(cfg.lists[1].today === true && !cfg.lists[0].today, "editor switch saves today: true on the list");
  ok((await ed().locator('[data-badges="lists-1"]').textContent()).includes("Today"), "list row shows a Today badge");
  ok((await pg.locator("skyfam-card .lists-col .card h2").textContent()).includes("Alex"), "preview updates");
  await pg.setViewportSize({ width: 1500, height: 900 }); await pg.screenshot({ path: `${out}/3-editor.png` });
  console.log(logs.filter((l) => l.includes("ERROR")).join("\n"));
  await b.close(); srv.close();
});
