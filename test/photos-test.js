// Photos tab: grid with manifest merge, fullscreen viewer, idle slideshow screensaver. Run: node photos-test.js shots-ph
const { chromium } = require("playwright"); const http=require("http"),fs=require("fs"),path=require("path"),assert=require("assert");
const root=path.resolve(__dirname,".."); const out=process.argv[2] || "shots-ph"; fs.mkdirSync(out,{recursive:true});
const srv=http.createServer((q,r)=>{const p=path.join(root,decodeURIComponent(q.url.split("?")[0]));if(!fs.existsSync(p)){r.writeHead(404);return r.end("nope");}r.writeHead(200,{"Content-Type":(p.endsWith(".js")?"text/javascript":p.endsWith(".svg")?"image/svg+xml":p.endsWith(".json")?"application/json":"text/html")+"; charset=utf-8"});fs.createReadStream(p).pipe(r);}).listen(8778,async()=>{
 const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1280,height:800}});
 const logs=[]; pg.on("console",m=>logs.push(m.text())); pg.on("pageerror",e=>logs.push("PAGEERROR "+e.message));
 const c=()=>pg.locator("skyfam-card"); const shot=async(pg,n)=>{await pg.waitForTimeout(250); await pg.screenshot({path:`${out}/${n}.png`});};
 const cfg=(extra)=>pg.evaluate((x)=>{ window.card.setConfig({ ...window.card._config, ...x }); }, extra);
 try {
  await pg.goto("http://localhost:8778/test/harness.html"); await pg.waitForTimeout(600);
  // the Photos tab exists, is last by default, and starts empty
  assert.deepEqual(await c().locator(".rail .nav > span:last-child").allInnerTexts(), ["Today","Planner","Week","Month","Chores","Lists","Challenges","Photos"], "Photos is the default last tab");
  await c().locator(".nav", {hasText:"Photos"}).click(); await pg.waitForTimeout(300);
  assert.ok(await c().locator(".body .empty:has-text('No photos yet')").isVisible(), "empty state with no photos configured");
  console.log("PASS photos tab shell");
  // grid: two pinned photos plus the manifest's, a duplicate URL is dropped, captions survive
  await cfg({ photos:[{url:"/test/fixtures/p1.svg", caption:"Pinned"}, "/test/fixtures/p2.svg"], photos_manifest:"/test/fixtures/photos.json" });
  await pg.waitForTimeout(500);
  assert.equal(await c().locator(".ph").count(), 3, "pinned + manifest merged, duplicate dropped");
  assert.match(await c().locator(".ph").first().locator("img").getAttribute("src"), /p1\.svg/, "pinned photos come first");
  assert.equal(await c().locator(".ph .cap").first().innerText(), "Pinned");
  await shot(pg, "1-grid");
  assert.match(await c().locator(".ph-grid").getAttribute("style"), /columns:3/, "3 photos fill the wide grid with 3 columns");
  // fullscreen viewer with wrapping prev/next
  await c().locator(".ph").first().click(); await pg.waitForTimeout(300);
  assert.ok(await pg.locator(".frame-host.on .fr-img").isVisible(), "viewer opens on tap");
  assert.equal(await pg.locator(".fr-cnt").innerText(), "1 / 3");
  await pg.locator(".fr-next").click(); await pg.waitForTimeout(250);
  assert.equal(await pg.locator(".fr-cnt").innerText(), "2 / 3");
  await pg.locator(".fr-prev").click(); await pg.locator(".fr-prev").click(); await pg.waitForTimeout(250);
  assert.equal(await pg.locator(".fr-cnt").innerText(), "3 / 3", "prev wraps past the first photo");
  // swipe left/right navigates without closing the viewer
  await pg.mouse.move(700,400); await pg.mouse.down(); await pg.mouse.move(480,400,{steps:8}); await pg.mouse.up(); await pg.waitForTimeout(300);
  assert.equal(await pg.locator(".fr-cnt").innerText(), "1 / 3", "swipe left goes to the next photo");
  assert.equal(await pg.locator(".frame-host.on").count(), 1, "swipe does not close the viewer");
  await pg.mouse.move(480,400); await pg.mouse.down(); await pg.mouse.move(700,400,{steps:8}); await pg.mouse.up(); await pg.waitForTimeout(300);
  assert.equal(await pg.locator(".fr-cnt").innerText(), "3 / 3", "swipe right goes back");
  await shot(pg, "2-viewer");
  await pg.locator(".fr-x").click(); await pg.waitForTimeout(250);
  assert.equal(await c().locator(".frame-host.on").count(), 0, "close exits the viewer");
  // a failed manifest keeps the pinned photos and shows a hint
  await cfg({ photos_manifest:"/test/fixtures/nope.json" }); await pg.waitForTimeout(500);
  assert.ok(await c().locator(".empty.small:has-text('Manifest failed')").isVisible(), "manifest error hint");
  assert.ok(await c().locator(".ph").first().isVisible(), "pinned photos survive a bad manifest");
  console.log("PASS grid + viewer");
  await shot(pg, "3-manifest-error");
  // idle slideshow: fractional idle config + real clocks (the card's tick runs every 15s, so we poll)
  const pg2=await b.newPage({viewport:{width:1280,height:800}});
  pg2.on("pageerror",e=>logs.push("PAGEERROR2 "+e.message));
  await pg2.goto("http://localhost:8778/test/harness.html?view=photos"); await pg2.waitForTimeout(800);
  await pg2.evaluate(()=>window.card.setConfig({...window.card._config, photos:["/test/fixtures/p1.svg","/test/fixtures/p2.svg","/test/fixtures/p3.svg"], photos_slideshow_minutes:0.02, photos_slideshow_seconds:4}));
  await pg2.waitForTimeout(400);
  assert.equal(await pg2.locator(".frame-host.on").count(), 0, "no screensaver while active");
  await pg2.waitForFunction(() => window.card._frame && window.card._frame.ss, null, {timeout: 30000});
  assert.ok(await pg2.locator(".frame-host.on.ss .fr-img").isVisible(), "screensaver starts after the idle delay");
  assert.equal(await pg2.locator(".frame-host.on .fr-bg").count(), 1, "blurred backdrop behind the photo");
  assert.equal(await pg2.locator(".fr-x").count(), 0, "screensaver has no controls");
  // the photo rotates every photos_slideshow_seconds
  const src1 = await pg2.locator(".fr-img").getAttribute("src");
  await pg2.waitForFunction(([s]) => { const el = document.querySelector("skyfam-card").shadowRoot.querySelector(".fr-img"); return el && el.getAttribute("src") !== s; }, [src1], {timeout: 10000});
  console.log("PASS screensaver start + rotation");
  await shot(pg2, "4-screensaver");
  await pg2.mouse.click(640,400); await pg2.waitForTimeout(300);
  assert.equal(await pg2.locator(".frame-host.on").count(), 0, "a tap exits the screensaver");
  assert.ok(await pg2.locator(".ph").first().isVisible(), "back to the grid after the screensaver");
  console.log("PASS slideshow");
  // tabs list honors photos (order + hidden), phone layout
  await cfg({ tabs:["photos","today"] }); await pg.waitForTimeout(300);
  assert.deepEqual(await c().locator(".rail .nav > span:last-child").allInnerTexts(), ["Photos","Today"], "tabs honors order and hides the rest");
  assert.ok(await c().locator(".ph").first().isVisible(), "start view falls back to the first tab");
  await pg.setViewportSize({width:390,height:840}); await pg.waitForTimeout(400);
  assert.match(await c().locator(".ph-grid").getAttribute("style"), /columns:2/, "rotating to phone width re-renders with 2 columns");
  assert.equal(await pg.locator(".fr-x").count(), 0);
  await shot(pg, "5-phone");
  console.log("PASS tabs + phone");
 } catch (e) { console.log("FAIL", e.message); process.exitCode = 1; }
 const errs = logs.filter(l => l.startsWith("PAGEERROR")); if (errs.length) { console.log(errs.join("\n")); process.exitCode = 1; }
 await b.close(); srv.close();});
