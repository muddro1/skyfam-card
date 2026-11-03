// Day-based chores and atomic star changes. Run: node days-stars-test.js shots-ds
const { chromium } = require("playwright"); const http=require("http"),fs=require("fs"),path=require("path"),assert=require("assert");
const root=path.resolve(__dirname,".."); const out=process.argv[2] || "shots-ds"; fs.mkdirSync(out,{recursive:true});
const srv=http.createServer((q,r)=>{const p=path.join(root,decodeURIComponent(q.url.split("?")[0]));r.writeHead(200,{"Content-Type":(p.endsWith(".js")?"text/javascript":p.endsWith(".svg")?"image/svg+xml":"text/html")+"; charset=utf-8"});fs.createReadStream(p).pipe(r);}).listen(8768,async()=>{
 const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1280,height:800}});
 const logs=[]; pg.on("console",m=>logs.push(m.text())); pg.on("pageerror",e=>logs.push("PAGEERROR "+e.message));
 const c=()=>pg.locator("skyfam-card"); const shot=async(n)=>{await pg.waitForTimeout(250); await pg.screenshot({path:`${out}/${n}.png`});};
 try {
  await pg.goto("http://localhost:8768/test/harness.html?view=chores"); await pg.waitForTimeout(500);
  // "Trash out" is set for two days that aren't today: hidden normally, shown dimmed in edit mode
  assert.equal(await c().locator(".chore:has-text('Trash out')").count(), 0, "off-day chore hidden");
  await c().locator("[data-act=chore-edit]").click(); await shot("1-edit-offday");
  assert.equal(await c().locator(".chore.offday:has-text('Trash out')").count(), 1, "off-day chore shown dimmed in edit mode");
  // edit it to run today too and check the saved description
  await c().locator(".chore:has-text('Trash out')").click(); await shot("2-form-days");
  const today = await pg.evaluate(() => new Date().getDay());
  await c().locator(`.modal label:has(input[name=day][value="${today}"]) span`).click();
  await c().locator("[data-act=chore-save]").click(); await pg.waitForTimeout(200);
  await c().locator("[data-act=chore-edit]").click(); await pg.waitForTimeout(200);
  assert.equal(await c().locator(".chore:not(.offday):has-text('Trash out')").count(), 1, "chore shows after adding today");
  const desc = logs.filter(l => l.startsWith("SERVICE todo update_item")).pop();
  assert.match(desc, /evening 3⭐ (sun|mon|tue|wed|thu|fri|sat)(,(sun|mon|tue|wed|thu|fri|sat)){2}"/, desc);
  // ticking a 3-star chore sends three increments, no set_value
  logs.length = 0;
  await c().locator(".chore:has-text('Trash out')").click(); await pg.waitForTimeout(300);
  assert.equal(logs.filter(l => l.startsWith("SERVICE counter increment")).length, 3, "3 increments");
  assert.equal(logs.filter(l => l.includes("set_value")).length, 0, "no set_value");
  // untick takes them back
  logs.length = 0;
  await c().locator(".chore:has-text('Trash out')").click(); await pg.waitForTimeout(300);
  assert.equal(logs.filter(l => l.startsWith("SERVICE counter decrement")).length, 3, "3 decrements");
  // redeeming a 5-star reward for Mia (12 stars) leaves 7
  await c().locator(".bank").first().click(); await c().locator("[data-act=redeem]").first().click();
  await c().locator("[data-act=confirm-yes]").click(); await pg.waitForTimeout(400);
  assert.match(await c().locator(".bank").first().innerText(), /⭐ 7/); await shot("3-after-redeem");
  console.log("PASS");
 } catch (e) { console.log("FAIL", e.message); process.exitCode = 1; }
 const errs = logs.filter(l => l.startsWith("PAGEERROR")); if (errs.length) { console.log(errs.join("\n")); process.exitCode = 1; }
 await b.close(); srv.close();});
