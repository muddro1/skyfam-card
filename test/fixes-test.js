// Audit fixes: idle relocks chore editing, typing counts as activity, failed saves undo the tick,
// editing a "[Name] - " tagged event keeps the tag, planner on a clock-change day. Run: node fixes-test.js
const { chromium } = require("playwright"); const http = require("http"), path = require("path");
const root = path.resolve(__dirname, "..");
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split("?")[0])); r.writeHead(200, { "Content-Type": (p.endsWith(".js") ? "text/javascript" : p.endsWith(".svg") ? "image/svg+xml" : "text/html") + "; charset=utf-8" }); require("fs").createReadStream(p).pipe(r); }).listen(8779, async () => {
  const b = await chromium.launch();
  const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) process.exitCode = 1; };
  const open = async (opts = {}, setup) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, ...opts });
    const pg = await ctx.newPage(); const logs = [];
    pg.on("console", (m) => logs.push(m.text())); pg.on("pageerror", (e) => logs.push("PAGEERROR " + e.message));
    if (setup) await setup(pg);
    await pg.goto("http://localhost:8779/test/harness.html"); await pg.waitForTimeout(600);
    return { pg, logs, c: () => pg.locator("skyfam-card") };
  };

  { // 1. idle return turns chore edit mode off, even when already on the start view
    const { pg, c } = await open();
    await c().locator(".rail [data-v=chores]").click(); await c().locator("[data-act=chore-edit]").click();
    const r = await pg.evaluate(() => { const k = window.card; k._config.idle_return_minutes = 1; k._config.default_view = "chores"; k._lastTouch = 0; k._onTick(); return k._editChores; });
    ok(r === false, "idle relocks chore edit mode");
    await pg.context().close();
  }

  { // 3 + 4. typing counts as activity; a failed save puts the tick and the typed text back
    const { pg, c } = await open();
    await pg.evaluate(() => { window.card._lastTouch = 0; });
    await c().locator('[data-add="todo.home"]').type("milk");
    ok(await pg.evaluate(() => window.card._lastTouch > 0), "typing resets the idle timer");
    await pg.evaluate(() => { const h = window.card._hass; window.card._hass = { ...h, callService: () => Promise.reject(new Error("offline")) }; });
    await c().locator('[data-add="todo.home"]').press("Enter"); await pg.waitForTimeout(100);
    ok((await c().locator('[data-add="todo.home"]').inputValue()) === "milk", "failed add keeps the typed text");
    const row = c().locator('.todo[data-uid="h1"]');
    await row.click(); await pg.waitForTimeout(100);
    ok(!(await row.evaluate((el) => el.classList.contains("done"))), "failed todo save undoes the tick");
    const chore = c().locator('.chore-row[data-uid="c3"]');
    await chore.click(); await pg.waitForTimeout(100);
    ok(await pg.evaluate(() => window.card._todos["todo.mia_chores"].find((i) => i.uid === "c3").status === "needs_action"), "failed chore save undoes the tick");
    await pg.context().close();
  }

  { // 2. a tagged event on a shared calendar keeps its tag when edited, for a person without prefix_titles
    const { pg, c, logs } = await open();
    await pg.evaluate(() => {
      const k = window.card, h = k._hass, t = new Date(); t.setDate(t.getDate() + 1); t.setHours(10, 0, 0, 0);
      const ev = { uid: "t1", summary: "[Jordan] - Dentist", start: { dateTime: t.toISOString() }, end: { dateTime: new Date(+t + 3600000).toISOString() } };
      k._hass = { ...h, callApi: async (m, p) => (p.startsWith("calendars/calendar.family?") ? [...await h.callApi(m, p), ev] : h.callApi(m, p)) };
      k._calChanged();
    });
    await pg.waitForTimeout(300);
    await c().locator(".agenda:has-text('Dentist')").click(); await c().locator("[data-act=event-edit]").click();
    await c().locator(".modal [name=location]").fill("Main St"); await c().locator(".modal [data-act=save-event]").click(); await pg.waitForTimeout(300);
    const up = logs.filter((l) => l.startsWith("WS ")).map((l) => JSON.parse(l.slice(3))).find((m) => m.type === "calendar/event/update");
    ok(up && up.event.summary === "[Jordan] - Dentist", "tag kept on edit: " + (up && up.event.summary));
    await pg.context().close();
  }

  { // 5. planner on a fall-back day (25 hours) places events and rows by clock time
    const { pg, c } = await open({ timezoneId: "America/New_York" }, (p) => p.clock.install({ time: new Date("2026-11-01T10:00:00-05:00") }));
    await c().locator(".rail [data-v=planner]").click(); await pg.waitForTimeout(300);
    const top = await c().locator(".pl-ev:has-text('Morning standup')").evaluate((el) => parseFloat(el.style.top));
    ok(top === 2 * 64, "8:00 event sits two rows below 6 AM: " + top);
    const lbl = (await c().locator(".pl-hr span").first().textContent()).trim(); ok(lbl === "6a", "first row says 6a: " + lbl);
    await pg.context().close();
  }
  await b.close(); srv.close();
});
