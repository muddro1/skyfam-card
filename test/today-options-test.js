// Today options (past events hidden, event weather) and tab order. Run: node today-options-test.js shots-to
const { chromium } = require("playwright"); const http=require("http"),fs=require("fs"),path=require("path"),assert=require("assert");
const root=path.resolve(__dirname,".."); const out=process.argv[2] || "shots-to"; fs.mkdirSync(out,{recursive:true});
const srv=http.createServer((q,r)=>{const p=path.join(root,decodeURIComponent(q.url.split("?")[0]));r.writeHead(200,{"Content-Type":(p.endsWith(".js")?"text/javascript":p.endsWith(".svg")?"image/svg+xml":"text/html")+"; charset=utf-8"});fs.createReadStream(p).pipe(r);}).listen(8769,async()=>{
 const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1280,height:800}});
 const logs=[]; pg.on("console",m=>logs.push(m.text())); pg.on("pageerror",e=>logs.push("PAGEERROR "+e.message));
 const c=()=>pg.locator("skyfam-card"); const shot=async(n)=>{await pg.waitForTimeout(250); await pg.screenshot({path:`${out}/${n}.png`});};
 const cfg=(extra)=>pg.evaluate((x)=>{ window.card.setConfig({ ...window.card._config, ...x }); }, extra);
 const today=()=>c().locator(".day-block").first();
 try {
  const t = new Date(); t.setHours(15, 30, 0, 0);
  await pg.clock.setFixedTime(t);
  await pg.goto("http://localhost:8769/test/harness.html"); await pg.waitForTimeout(500);
  // default: the 8am standup is past and greyed out
  assert.equal(await today().locator(".agenda.past:has-text('Morning standup')").count(), 1, "past event dimmed by default");
  assert.equal(await c().locator(".a-wx").count(), 0, "no event weather by default");
  await cfg({ today_past_events: "hide" }); await pg.waitForTimeout(200);
  assert.equal(await today().locator(":has-text('Morning standup')").count(), 0, "past event hidden");
  assert.equal(await today().locator(".agenda:has-text('Gymnastics')").count(), 1, "upcoming event still shown");
  console.log("PASS past events hide");
  // event weather: Gymnastics at 4:15pm gets the 4pm hourly entry (50+16 = 66°); tomorrow's all-day falls back to daily
  await cfg({ event_weather: true }); await pg.waitForTimeout(300);
  assert.match(await today().locator(".agenda:has-text('Gymnastics') .a-wx").innerText(), /☀️ 66°/);
  assert.match(await c().locator(".agenda:has-text('Tutoring') .a-wx").innerText(), /☀️ \d+°/);
  await shot("1-today-hide-weather"); console.log("PASS event weather");
  // tabs: reordered and Month hidden; start view falls back to the first tab when its tab is hidden
  await cfg({ tabs: ["chores", "today", "week"] }); await pg.waitForTimeout(200);
  assert.deepEqual(await c().locator(".rail .nav > span:last-child").allInnerTexts(), ["Chores", "Today", "Week"]);
  await cfg({ tabs: ["chores", "week"] }); await pg.waitForTimeout(200);
  assert.equal(await c().locator(".rail .nav.on > span:last-child").innerText(), "Chores", "hidden start view falls back to first tab");
  await cfg({ tabs: [] }); await pg.waitForTimeout(200);
  assert.equal(await c().locator(".rail .nav").count(), 6, "empty tabs shows all");
  await shot("2-tabs"); console.log("PASS tabs");
  // header_buttons: own shortcut links next to the theme button; javascript: links are dropped
  await cfg({ tabs: [], header_buttons: [{ name: "Camera", icon: "📷", url: "ks://camera" }, { url: "javascript:alert(1)" }, { name: "No link" }] }); await pg.waitForTimeout(200);
  const hb = c().locator(".top a.hbtn");
  assert.equal(await hb.count(), 1, "only the valid button renders");
  assert.equal(await hb.getAttribute("href"), "ks://camera");
  assert.equal((await hb.innerText()).replace(/\s+/g, " ").trim(), "📷 Camera");
  await shot("3-header-button");
  // tap_action buttons fire HA's hass-action (e.g. a browser_mod popup); show_on hides a button on phones / non-phones
  await pg.evaluate(() => { window.__acts = []; window.addEventListener("hass-action", (e) => window.__acts.push(e.detail)); });
  const pop = { action: "fire-dom-event", browser_mod: { service: "browser_mod.popup", data: { title: "Front door" } } };
  await cfg({ tabs: [], header_buttons: [{ name: "Camera", icon: "📷", url: "ks://camera", show_on: "not_phone" }, { name: "Door", icon: "🚪", tap_action: pop, show_on: "phone" }] }); await pg.waitForTimeout(200);
  assert.ok(await c().locator(".top a.hbtn").isVisible(), "not_phone button shows on a wide screen");
  assert.ok(!(await c().locator(".top button.hbtn").isVisible()), "phone-only button hidden on a wide screen");
  await pg.setViewportSize({ width: 400, height: 800 }); await pg.waitForTimeout(200);
  assert.ok(!(await c().locator(".top a.hbtn").isVisible()), "not_phone button hidden on a phone");
  await c().locator(".top button.hbtn").click();
  assert.deepEqual(await pg.evaluate(() => window.__acts), [{ config: { tap_action: pop }, action: "tap" }], "tap fires hass-action");
  await pg.setViewportSize({ width: 1280, height: 800 });
  console.log("PASS header buttons");
 } catch (e) { console.log("FAIL", e.message); process.exitCode = 1; }
 const errs = logs.filter(l => l.startsWith("PAGEERROR")); if (errs.length) { console.log(errs.join("\n")); process.exitCode = 1; }
 await b.close(); srv.close();});
