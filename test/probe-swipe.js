// probe: open viewer, mouse-swipe, report what the card saw
const { chromium } = require("playwright"); const http=require("http"),fs=require("fs"),path=require("path");
const root=path.resolve(__dirname,"..");
const srv=http.createServer((q,r)=>{const p=path.join(root,decodeURIComponent(q.url.split("?")[0]));if(!fs.existsSync(p)){r.writeHead(404);return r.end("nope");}r.writeHead(200,{"Content-Type":(p.endsWith(".js")?"text/javascript":p.endsWith(".svg")?"image/svg+xml":p.endsWith(".json")?"application/json":"text/html")+"; charset=utf-8"});fs.createReadStream(p).pipe(r);}).listen(8779,async()=>{
 const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1280,height:800}});
 await pg.goto("http://localhost:8779/test/harness.html");
 await pg.waitForTimeout(600);
 // instrument: log every pointer event the shadow root sees
 await pg.evaluate(()=>{ const sr=window.card.shadowRoot; window.__evts=[]; ["pointerdown","pointerup","pointercancel","click"].forEach(t=>sr.addEventListener(t,e=>window.__evts.push(t+" "+e.clientX+","+e.clientY+" target="+(e.target.className||e.target.tagName)),{capture:true})); });
 await pg.locator("skyfam-card").locator(".nav", {hasText:"Photos"}).click(); await pg.waitForTimeout(200);
 await pg.evaluate(()=>window.card.setConfig({...window.card._config, photos:["/test/fixtures/p1.svg","/test/fixtures/p2.svg","/test/fixtures/p3.svg"]}));
 await pg.waitForTimeout(400);
 await pg.locator("skyfam-card").locator(".ph").first().click(); await pg.waitForTimeout(300);
 console.log("viewer open:", await pg.locator(".fr-img").isVisible(), "cnt:", await pg.locator(".fr-cnt").innerText());
 await pg.mouse.move(700,400); await pg.mouse.down(); await pg.mouse.move(480,400,{steps:8}); await pg.mouse.up(); await pg.waitForTimeout(400);
 console.log("after swipe cnt:", await pg.locator(".fr-cnt").count() ? await pg.locator(".fr-cnt").innerText() : "(viewer closed!)");
 console.log("events:", (await pg.evaluate(()=>window.__evts)).join("\n"));
 await b.close(); srv.close();
});
