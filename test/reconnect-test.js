// Chores come back after the websocket reconnects without a page refresh. Run: node reconnect-test.js
const { chromium } = require("playwright"); const http = require("http"), fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "..");
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split("?")[0])); r.writeHead(200, { "Content-Type": (p.endsWith(".js") ? "text/javascript" : p.endsWith(".svg") ? "image/svg+xml" : "text/html") + "; charset=utf-8" }); fs.createReadStream(p).pipe(r); }).listen(8777, async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; pg.on("pageerror", (e) => errs.push(e.message));
  const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) process.exitCode = 1; };
  const chores = () => pg.locator("skyfam-card .kid:has-text('Mia') .chore").count();
  await pg.goto("http://localhost:8777/test/harness.html"); await pg.waitForTimeout(600);
  await pg.locator("skyfam-card .rail [data-v=chores]").click(); await pg.waitForTimeout(200);
  ok((await chores()) > 0, "chores load");
  // connection not ready: todo subscribes fail
  await pg.evaluate(() => {
    const card = document.querySelector("skyfam-card"), real = card._hass.connection, fake = new EventTarget();
    window.haUp = false;
    fake.subscribeMessage = (cb, msg) => (msg.type === "todo/item/subscribe" && !window.haUp ? Promise.reject({ code: "not_found" }) : real.subscribeMessage(cb, msg));
    card._hass = { ...card._hass, connection: fake }; window.fake = fake;
    card._resubscribe();
  });
  await pg.waitForTimeout(200);
  ok((await chores()) === 0, "chores empty while HA is starting");
  ok(await pg.evaluate(() => !!document.querySelector("skyfam-card")._retryT), "a retry is scheduled");
  await pg.evaluate(() => { window.haUp = true; window.fake.dispatchEvent(new Event("ready")); });
  await pg.waitForTimeout(200);
  ok((await chores()) > 0, "chores back after reconnect, no refresh");
  errs.forEach((e) => { console.log("PAGEERROR " + e); process.exitCode = 1; });
  await b.close(); srv.close();
});
