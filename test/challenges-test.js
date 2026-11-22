// Challenges: one sticker a day, prize at the goal. Run: node challenges-test.js shots-ch
const { chromium } = require("playwright"); const http = require("http"), fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, ".."); const out = process.argv[2] || "shots-ch"; fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split("?")[0])); r.writeHead(200, { "Content-Type": (p.endsWith(".js") ? "text/javascript" : p.endsWith(".svg") ? "image/svg+xml" : "text/html") + "; charset=utf-8" }); fs.createReadStream(p).pipe(r); }).listen(8780, async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const logs = []; pg.on("console", (m) => logs.push(m.text())); pg.on("pageerror", (e) => logs.push("PAGEERROR " + e.message));
  const c = () => pg.locator("skyfam-card"); const modal = () => c().locator(".modal");
  const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) process.exitCode = 1; };
  const svc = (s) => logs.filter((l) => l.startsWith("SERVICE todo " + s))// "SERVICE todo add_item {data} {target}"
    .map((l) => ({ data: JSON.parse(l.slice(l.indexOf("{"), l.lastIndexOf(" {"))), target: JSON.parse(l.slice(l.lastIndexOf(" {") + 1)) }));
  const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const shot = async (n) => { await pg.waitForTimeout(250); await pg.screenshot({ path: `${out}/${n}.png` }); };
  await pg.goto("http://localhost:8780/test/harness.html"); await pg.waitForTimeout(600);

  ok((await c().locator(".rail [data-v=challenges]").count()) === 1, "Challenges tab shows when challenges_list is set");
  await c().locator(".rail [data-v=challenges]").click(); await pg.waitForTimeout(200);
  const leo = c().locator(".chal:has-text('Sleep in your bed')"), mia = c().locator(".chal:has-text('Read for 20 minutes')");
  ok((await leo.locator(".stk").count()) === 15 && (await leo.locator(".stk.on").count()) === 7, "Leo: 15 spots, 7 stickers");
  ok((await leo.innerText()).includes("7 of 15") && (await leo.innerText()).includes("New Lego set"), "progress and prize shown");
  await shot("1-challenges");

  await leo.locator("[data-act=ch-sticker]").click(); await pg.waitForTimeout(200);
  let up = svc("update_item").filter((x) => x.target.entity_id === "todo.skyfam_challenges");
  // the prize has "stickers" in it; the real stickers must still be read and kept
  ok(up.length === 1 && up[0].data.description.includes(today) && up[0].data.description.startsWith("Leo · goal 15 · prize 🧸 New Lego set and stickers · stickers ")
    && up[0].data.description.split(" ").filter((w) => /^\d{4}-/.test(w)).length === 8, "sticker saved with today's date, earlier ones kept: " + (up[0] && up[0].data.description));
  ok((await leo.locator(".stk.on").count()) === 8 && (await leo.locator("[data-act=ch-sticker]").count()) === 0, "8 stickers, and no second sticker today");
  await pg.evaluate(() => window.card._addSticker("ch1"));
  ok(svc("update_item").filter((x) => x.target.entity_id === "todo.skyfam_challenges").length === 1, "a second sticker the same day is ignored");
  await shot("2-sticker");

  // the reset after the win fails once (connection blip): the card keeps the stickers and offers a retry
  await pg.evaluate(() => {
    const k = window.card, h = k._hass; let fail = 1;
    k._hass = { ...h, callService: (d, s, data, t) => (fail && t.entity_id === "todo.skyfam_challenges" && /won /.test(data.description || "") ? (fail--, Promise.reject(new Error("offline"))) : h.callService(d, s, data, t)) };
  });
  await mia.locator("[data-act=ch-sticker]").click(); await pg.waitForTimeout(400);
  const owedAdds = () => svc("add_item").filter((x) => x.target.entity_id === "todo.skyfam_rewards_owed");
  ok(owedAdds().length === 1 && owedAdds()[0].data.item === "🍕 Pick Friday dinner" && owedAdds()[0].data.description.startsWith("Mia · Read for 20 minutes · redeemed "), "10th sticker puts the prize on the owed list");
  ok((await mia.locator(".stk.on").count()) === 10 && (await mia.locator("[data-act=ch-claim]").count()) === 1, "failed reset keeps the stickers and shows Get the prize");
  await mia.locator("[data-act=ch-claim]").click(); await pg.waitForTimeout(400);
  ok(owedAdds().length === 1, "the retry doesn't add the prize twice");
  up = svc("update_item").filter((x) => x.target.entity_id === "todo.skyfam_challenges" && x.data.item === "ch2");
  ok(up.length === 2 && up[1].data.description === `Mia · goal 10 · prize 🍕 Pick Friday dinner · won ${today}`, "then the challenge starts over: " + (up[1] && up[1].data.description));
  ok((await mia.locator(".stk.on").count()) === 0, "Mia's card is empty again");
  ok((await mia.locator("[data-act=ch-sticker]").count()) === 0 && (await mia.innerText()).includes("New stickers start tomorrow"), "the winning day doesn't also start the next round");
  await shot("3-won");

  // new challenge
  await c().locator("[data-act=ch-add]").click();
  await modal().locator("[name=name]").fill("Brush teeth without asking"); await c().locator('[data-act=emoji-pick][data-e="🪥"]').click();
  await modal().locator("label:has(input[value=Leo]) span").click();
  await modal().locator('[data-act=step][data-n=goal][data-d="1"]').click();
  await modal().locator("[name=prize]").fill("🎢 Trip to the fun park");
  await shot("4-form");
  await modal().locator("[data-act=ch-save]").click(); await pg.waitForTimeout(200);
  const add = svc("add_item").find((x) => x.target.entity_id === "todo.skyfam_challenges");
  ok(add && add.data.item === "🪥 Brush teeth without asking" && add.data.description === "Leo · goal 16 · prize 🎢 Trip to the fun park", "new challenge saved: " + (add && add.data.description));

  // a parent takes a wrong sticker off
  await leo.locator("[data-act=ch-open]").click(); await pg.waitForTimeout(100);
  await modal().locator("[data-act=ch-unsticker]").click(); await pg.waitForTimeout(200);
  up = svc("update_item").filter((x) => x.data.item === "ch1");
  ok(!up[up.length - 1].data.description.includes(today) && (await modal().locator(".ch-count").innerText()) === "7 of 15", "last sticker taken off");
  await modal().locator("[data-act=close]").click();

  // hand-edited items: a decimal goal, no emoji, and two challenges with the same prize (⭐ in one name)
  await pg.evaluate(async () => {
    const add = (item, description) => window.card._hass.callService("todo", "add_item", { item, description }, { entity_id: "todo.skyfam_challenges" });
    await add("Practice piano", "Leo · goal 14.5");
    await add("🥦 Eat a vegetable", "Leo · goal 1 · prize 🍦 Ice cream");
    await add("🧹 Tidy up 5 ⭐ times", "Leo · goal 1 · prize 🍦 Ice cream");
  });
  await pg.waitForTimeout(200);
  const piano = c().locator(".chal:has-text('Practice piano')");
  ok((await c().locator(".body").innerText()).includes("Practice piano") && (await piano.locator(".stk").count()) === 15, "decimal goal is rounded, the tab still renders");
  await piano.locator("[data-act=ch-open]").click(); await pg.waitForTimeout(100);
  ok((await modal().locator("[name=emoji]").inputValue()) === "", "edit form has no made-up emoji");
  await modal().locator("[data-act=ch-save]").click(); await pg.waitForTimeout(200);
  const ren = svc("update_item").filter((x) => x.target.entity_id === "todo.skyfam_challenges" && x.data.rename).pop();
  ok(ren && ren.data.rename === "Practice piano", "saving keeps the title without ⭐: " + (ren && ren.data.rename));
  const before = owedAdds().length;
  await c().locator(".chal:has-text('Eat a vegetable') [data-act=ch-sticker]").click(); await pg.waitForTimeout(400);
  await c().locator(".chal:has-text('Tidy up') [data-act=ch-sticker]").click(); await pg.waitForTimeout(400);
  const ice = owedAdds().slice(before);
  ok(ice.length === 2 && ice.every((x) => x.data.item === "🍦 Ice cream"), "two challenges with the same prize give two prizes");
  ok(ice[1] && ice[1].data.description.startsWith("Leo · Tidy up 5 times · redeemed ") && !ice[1].data.description.includes("⭐"), "no ⭐ from the name in the owed item: " + (ice[1] && ice[1].data.description));

  // phone: the extra tab still fits the bottom bar
  await pg.setViewportSize({ width: 375, height: 760 }); await pg.waitForTimeout(200);
  ok(await c().locator(".rail").evaluate((el) => el.scrollWidth <= el.clientWidth + 1), "tabs fit on a phone");
  await shot("5-phone");

  // no list, no tab
  await pg.evaluate(() => { const k = window.card, cf = { ...k._config }; delete cf.challenges_list; k.setConfig(cf); });
  ok((await c().locator(".rail [data-v=challenges]").count()) === 0, "tab hidden without challenges_list");

  logs.filter((l) => l.startsWith("PAGEERROR")).forEach((l) => { console.log(l); process.exitCode = 1; });
  await b.close(); srv.close();
});
