// Parent star adjuster: PIN gate, +1/-1 via increment/decrement, exact set. Run: node stars-adjust-test.js shots-sa
const { chromium } = require("playwright"); const http=require("http"),fs=require("fs"),path=require("path"),assert=require("assert");
const root=path.resolve(__dirname,".."); const out=process.argv[2] || "shots-sa"; fs.mkdirSync(out,{recursive:true});
const srv=http.createServer((q,r)=>{const p=path.join(root,decodeURIComponent(q.url.split("?")[0]));r.writeHead(200,{"Content-Type":(p.endsWith(".js")?"text/javascript":p.endsWith(".svg")?"image/svg+xml":"text/html")+"; charset=utf-8"});fs.createReadStream(p).pipe(r);}).listen(8769,async()=>{
 const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1280,height:800}});
 const logs=[]; pg.on("console",m=>logs.push(m.text())); pg.on("pageerror",e=>logs.push("PAGEERROR "+e.message));
 const c=()=>pg.locator("skyfam-card"); const shot=async(n)=>{await pg.waitForTimeout(250); await pg.screenshot({path:`${out}/${n}.png`});};
 const svc=(re)=>logs.filter(l=>re.test(l)).length;
 try {
  await pg.goto("http://localhost:8769/test/harness.html?view=chores&pin=1234"); await pg.waitForTimeout(500);
  await c().locator(".bank").first().click();                       // Mia, 12 stars
  await c().locator("[data-act=stars-adjust]").click();
  assert.equal(await c().locator(".pin-dots").count(), 1, "asks for PIN");
  for (const d of ["1","2","3","4"]) await c().locator(`[data-act=pin][data-d="${d}"]`).click();
  await shot("1-adjust");
  assert.match(await c().locator(".modal").innerText(), /12 stars now/);
  await c().locator('[data-act=star-adj][data-d="1"]').click(); await pg.waitForTimeout(200);
  await c().locator('[data-act=star-adj][data-d="1"]').click(); await pg.waitForTimeout(200);
  await c().locator('[data-act=star-adj][data-d="-1"]').click(); await pg.waitForTimeout(200);
  assert.equal(svc(/SERVICE counter increment/), 2); assert.equal(svc(/SERVICE counter decrement/), 1);
  assert.match(await c().locator(".modal").innerText(), /13 stars now/, "modal shows live balance");
  await c().locator('.modal [name="stars-to"]').fill("-3"); await c().locator("[data-act=star-set]").click();
  assert.equal(svc(/set_value/), 0, "negative rejected");
  await c().locator('.modal [name="stars-to"]').fill("20"); await c().locator("[data-act=star-set]").click(); await pg.waitForTimeout(300);
  assert.equal(svc(/SERVICE counter set_value \{"value":20\}/), 1);
  await shot("2-after-set");
  assert.match(await c().locator(".modal").innerText(), /20 stars now/);
  await c().locator(".modal [data-act=close]").click(); await pg.waitForTimeout(200);
  assert.match(await c().locator(".bank").first().innerText(), /⭐ 20/);
  console.log("PASS");
 } catch (e) { console.log("FAIL", e.message); process.exitCode = 1; }
 const errs = logs.filter(l => l.startsWith("PAGEERROR")); if (errs.length) { console.log(errs.join("\n")); process.exitCode = 1; }
 await b.close(); srv.close();});
