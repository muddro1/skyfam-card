// Events: combined duplicates, edit, delete, repeating events and notes. Run: node events-test.js shots-ev
const { chromium } = require("playwright"); const http = require("http"), fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, ".."); const out = process.argv[2] || "shots-ev"; fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split("?")[0])); r.writeHead(200, { "Content-Type": (p.endsWith(".js") ? "text/javascript" : p.endsWith(".svg") ? "image/svg+xml" : "text/html") + "; charset=utf-8" }); fs.createReadStream(p).pipe(r); }).listen(8776, async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const logs = []; pg.on("console", (m) => logs.push(m.text())); pg.on("pageerror", (e) => logs.push("PAGEERROR " + e.message));
  const c = () => pg.locator("skyfam-card"); const modal = () => c().locator(".modal");
  const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) process.exitCode = 1; };
  const ws = (type) => logs.filter((l) => l.startsWith("WS ")).map((l) => JSON.parse(l.slice(3))).filter((m) => m.type === type);
  const shot = async (n) => { await pg.waitForTimeout(250); await pg.screenshot({ path: `${out}/${n}.png` }); };
  await pg.goto("http://localhost:8776/test/harness.html"); await pg.waitForTimeout(600);

  // Soccer is on Mia's and Jordan's calendars: shown once, with both names
  const soccer = c().locator(".agenda:has-text('Soccer Practice')");
  ok((await soccer.count()) === 1, "duplicate event shows once");
  ok((await soccer.locator(".a-who").allInnerTexts()).sort().join() === "Jordan,Mia", "combined event lists both people");
  ok(await soccer.evaluate((el) => el.classList.contains("multi")), "combined event gets two colors");
  await shot("1-today");

  await soccer.click(); await pg.waitForTimeout(200);
  ok((await modal().innerText()).includes("all 2 calendars"), "details say changes hit both calendars");
  await shot("2-detail");
  await modal().locator("[data-act=event-edit]").click();
  ok((await modal().locator("[name=title]").inputValue()) === "Soccer Practice", "edit form has the title without the [Mia] prefix");
  ok((await modal().locator("[name=repeat]").count()) === 1, "one-time event can be made to repeat");
  await modal().locator("[name=title]").fill("Soccer Game");
  await modal().locator("[name=location]").fill("Field 3");
  await modal().locator("[name=description]").fill("Bring shin guards");
  await shot("3-edit");
  await modal().locator("[data-act=save-event]").click(); await pg.waitForTimeout(400);
  const up = ws("calendar/event/update");
  ok(up.length === 2, "edit updates both copies");
  ok(up.some((m) => m.entity_id === "calendar.mia" && m.event.summary === "[Mia] - Soccer Game") && up.some((m) => m.entity_id === "calendar.jordan" && m.event.summary === "Soccer Game"), "each copy keeps its own title prefix");
  ok(up.every((m) => m.event.location === "Field 3" && m.event.description === "Bring shin guards" && !m.recurrence_id && !m.event.rrule), "location and notes saved, no repeat fields");
  ok(/T18:00:00[+-]\d\d:\d\d$/.test(up[0].event.dtstart), "times carry the device's UTC offset: " + up[0].event.dtstart);
  ok((await c().locator(".agenda:has-text('Soccer Game')").count()) === 1, "card refetches and shows the change");

  // repeating event: edit only this one, then delete this and later
  const piano = c().locator(".agenda:has-text('Piano lesson')");
  await piano.click(); await pg.waitForTimeout(200);
  ok((await modal().innerText()).includes("Every 2 weeks"), "repeat rule shown in words");
  ok((await modal().locator("[data-act=event-del]").count()) === 2, "repeating event offers two deletes");
  await modal().locator("[data-act=event-edit]").click();
  ok((await modal().locator("[name=repeat]").count()) === 0, "repeat picker hidden when editing a repeating event");
  await modal().locator("[name=title]").fill("Piano recital");
  await modal().locator("[data-act=save-event][data-scope=one]").click(); await pg.waitForTimeout(400);
  const pu = ws("calendar/event/update").pop();
  ok(pu.uid === "p1" && pu.recurrence_id === "P3" && !pu.recurrence_range && !pu.event.rrule, "save this one sends recurrence_id only");
  await c().locator(".agenda:has-text('Piano recital')").click(); await pg.waitForTimeout(200);
  await modal().locator("[data-act=event-del][data-scope=future]").click();
  ok((await modal().innerText()).includes("every time after"), "delete asks first");
  await modal().locator("[data-act=confirm-yes]").click(); await pg.waitForTimeout(400);
  const del = ws("calendar/event/delete").pop();
  ok(del && del.recurrence_id === "P3" && del.recurrence_range === "THISANDFUTURE", "delete this and later");

  // new repeating event with notes
  await c().locator(".fab[data-act=add-event]").click(); await pg.waitForTimeout(200);
  ok(!(await modal().locator(".rr-more").isVisible()), "repeat options hidden until a repeat is picked");
  await modal().locator("[name=title]").fill("Swim");
  // pick two kids instead of the default (Family)
  await modal().locator(".whochip", { hasText: "Family" }).click();
  await modal().locator(".whochip", { hasText: "Leo" }).click();
  await modal().locator(".whochip", { hasText: "Mia" }).click();
  await modal().locator("[name=repeat]").selectOption("WEEKLY");
  ok(await modal().locator(".rr-days").isVisible(), "weekly shows day picker");
  const wd = new Date().getDay(), other = (wd + 2) % 7;
  await modal().locator(`.rr-days .whochip:has([value="${other}"])`).click();
  const until = new Date(Date.now() + 30 * 864e5); const us = `${until.getFullYear()}-${String(until.getMonth() + 1).padStart(2, "0")}-${String(until.getDate()).padStart(2, "0")}`;
  await modal().locator("[name=until]").fill(us);
  await modal().locator("[name=description]").fill("Towel!");
  await shot("4-new-repeat");
  await modal().locator("[data-act=save-event]").click(); await pg.waitForTimeout(400);
  const crs = ws("calendar/event/create"), cr = crs[crs.length - 1];
  ok(crs.length === 2 && crs[0].entity_id === "calendar.mia" && crs[0].event.summary === "[Mia] - Swim", "two people: one event on each calendar");
  const days = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  ok(cr && cr.entity_id === "calendar.leo" && cr.event.summary === "[Leo] - Swim", "created on Leo's calendar with prefix");
  ok(cr.event.rrule.startsWith("FREQ=WEEKLY;BYDAY=") && cr.event.rrule.includes(days[wd]) && cr.event.rrule.includes(days[other]) && /;UNTIL=\d{8}T\d{6}Z$/.test(cr.event.rrule), "weekly rule with days and UTC until: " + cr.event.rrule);
  ok(cr.event.description === "Towel!", "notes saved on create");
  ok((await c().locator(".agenda:has-text('Swim')").count()) === 1 && (await c().locator(".agenda:has-text('Swim') .a-who").count()) === 2, "the two copies show as one event for both kids");

  // a shared entry with no calendar is left out
  await pg.evaluate(() => window.card.setConfig({ ...window.card._config, shared: [...window.card._config.shared, { name: "Family", color: "#ff8a65" }] }));
  await c().locator(".fab[data-act=add-event]").click(); await pg.waitForTimeout(200);
  ok((await modal().locator(".whochip", { hasText: "Family" }).count()) === 1, "empty shared entry not offered");
  await modal().locator("[data-act=close]").first().click();

  // all-day multi-day event keeps its length when edited
  await c().locator(".nav[data-v=week]").click(); await pg.waitForTimeout(400);
  if (!(await c().locator(".pill:has-text('Kids sleepover')").count())) { await c().locator("[data-act=next]").first().click(); await pg.waitForTimeout(400); }
  await c().locator(".pill:has-text('Kids sleepover')").first().click(); await pg.waitForTimeout(200);
  await modal().locator("[data-act=event-edit]").click();
  await modal().locator("[data-act=save-event]").click(); await pg.waitForTimeout(400);
  const sl = ws("calendar/event/update").pop();
  ok(sl.uid === "f2" && (new Date(sl.event.dtend) - new Date(sl.event.dtstart)) / 864e5 === 2, "two-day event stays two days: " + sl.event.dtstart + " → " + sl.event.dtend);

  // a calendar that can't be edited shows no buttons
  await pg.evaluate(() => { const h = window.card._hass; window.card.hass = { ...h, states: { ...h.states, "calendar.alex": { state: "off", attributes: { supported_features: 1 } } } }; });
  await c().locator(".nav[data-v=today]").click(); await pg.waitForTimeout(300);
  await c().locator(".agenda:has-text('HOA meeting')").click(); await pg.waitForTimeout(200);
  ok((await modal().locator("[data-act=event-edit], [data-act=event-del]").count()) === 0, "no edit or delete when the calendar doesn't support it");

  console.log(logs.filter((l) => l.includes("PAGEERROR") || l.includes("Couldn't")).join("\n"));
  await b.close(); srv.close();
});
