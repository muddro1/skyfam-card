const { chromium } = require("playwright"); const http=require("http"),fs=require("fs"),path=require("path");
const root=path.resolve(__dirname,".."); const out=process.argv[2] || "shots-edit"; fs.mkdirSync(out,{recursive:true});
const srv=http.createServer((q,r)=>{const p=path.join(root,decodeURIComponent(q.url.split("?")[0]));r.writeHead(200,{"Content-Type":(p.endsWith(".js")?"text/javascript":"text/html")+"; charset=utf-8"});fs.createReadStream(p).pipe(r);}).listen(8767,async()=>{
 const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1280,height:800}});
 const logs=[]; pg.on("console",m=>logs.push(m.text())); pg.on("pageerror",e=>logs.push("PAGEERROR "+e.message));
 const c=()=>pg.locator("skyfam-card"); const shot=async(n)=>{await pg.waitForTimeout(250); await pg.screenshot({path:`${out}/${n}.png`});};
 await pg.goto("http://localhost:8767/test/harness.html?view=chores&pin=1234"); await pg.waitForTimeout(500);
 // PIN gate
 await c().locator("[data-act=chore-add]").first().click(); await shot("1-pin");
 for (const d of ["1","2","3","4"]) await c().locator(`[data-act=pin][data-d="${d}"]`).click();
 await shot("2-add-chore");
 await c().locator('.modal [name=name]').fill("Feed the dog"); await c().locator('[data-act=emoji-pick][data-e="🐶"]').click();
 await c().locator('.modal [name=period][value=morning] + span').click(); await c().locator('.modal [name=stars][value="2"] + span').click();
 await c().locator(".modal label:has(input[value=Leo]) span").click(); // uncheck Leo
 await c().locator("[data-act=chore-save]").click(); await shot("3-after-add");
 await c().locator("[data-act=chore-edit]").click(); await shot("4-edit-mode");
 await c().locator(".chore[data-act=chore-open]").first().click(); await shot("5-edit-chore");
 await c().locator('.modal [name=name]').fill("Make your bed nicely"); await c().locator("[data-act=chore-save]").click();
 await c().locator("[data-act=rewards-edit]").click(); await shot("6-rewards-edit");
 await c().locator("[data-act=reward-new]").click(); await c().locator('.modal [name=name]').fill("Pizza night"); await c().locator('[data-act=emoji-pick][data-e="🍕"]').click();
 await c().locator('[data-act=step][data-d="1"]').click(); await c().locator('[data-act=step][data-d="1"]').click(); await shot("7-reward-form");
 await c().locator("[data-act=reward-save]").click(); await shot("8-rewards-after");
 await c().locator("[data-act=close]").click(); await c().locator("[data-act=chore-edit]").click();
 await c().locator(".bank").first().click(); await shot("9-redeem");
 console.log(logs.filter(l=>!l.includes("SKYFAM")).join("\n")); await b.close(); srv.close();});
