// The editor's setup buttons: create a kid's chore list and star counter, the rewards lists, and the reset automation.
const { chromium } = require("playwright"); const http = require("http"), fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, ".."); const out = process.argv[2] || "shots-setup"; fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split("?")[0])); r.writeHead(200, { "Content-Type": (p.endsWith(".js") ? "text/javascript" : p.endsWith(".svg") ? "image/svg+xml" : "text/html") + "; charset=utf-8" }); fs.createReadStream(p).pipe(r); }).listen(8775, async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1500, height: 900 } });
  const logs = []; pg.on("console", (m) => logs.push(m.text())); pg.on("pageerror", (e) => logs.push("PAGEERROR " + e.message));
  const ed = () => pg.locator("skyfam-card-editor");
  const last = () => pg.evaluate(() => window.__configs[window.__configs.length - 1]);
  const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) process.exitCode = 1; };
  await pg.goto("http://localhost:8775/test/editor.html"); await pg.waitForTimeout(600);

  await ed().locator('details[data-sec="people-0"] > summary').click();
  await ed().locator('details[data-sec="people-2"] > summary').click();
  const alexBtn = ed().locator('[data-setup="people-0"]');
  ok((await alexBtn.textContent()).includes("chore list and star counter for Alex"), "button offered for a person without chores");
  ok((await ed().locator('[data-setup="people-2"]').count()) === 0, "no button for a person who has both");
  await alexBtn.click();
  ok((await alexBtn.textContent()) === "Creating…", "button shows it's working");
  await pg.waitForTimeout(1500);
  let c = await last();
  ok(c.people[0].chores === "todo.alex_s_chore_chart" && c.people[0].stars === "counter.alex_stars", "chore list and counter filled in: " + c.people[0].chores + " " + c.people[0].stars);
  ok((await ed().locator('[data-setup="people-0"]').count()) === 0, "button gone once done");
  const created = await pg.evaluate(() => window.__created);
  const ctr = created.find((x) => x.counter);
  ok(ctr && ctr.counter.step === 1 && ctr.counter.minimum === 0, "counter made with step 1, minimum 0");
  await pg.screenshot({ path: `${out}/1-person.png` });

  await ed().locator('details[data-sec="chores"] > summary').click();
  ok((await ed().locator('[data-setup="rewards"]').count()) === 0, "no rewards button when both lists are set");
  await ed().locator('[data-slot="chores"] input[name=rewards_owed_list]').fill("");
  await ed().locator('[data-setup="rewards"]').click(); await pg.waitForTimeout(1200);
  c = await last();
  ok(c.rewards_owed_list === "todo.skyfam_rewards_owed" && c.rewards_list === "todo.skyfam_rewards", "owed list created, rewards list kept");

  await ed().locator('[data-slot="chores"] input[name=rewards_list]').fill("");
  await ed().locator('[data-setup="rewards"]').click(); await pg.waitForTimeout(600);
  ok((await ed().locator('[data-setup-box="chores"] .err').textContent()).includes("already exists"), "existing list name shows an error");

  const reset = ed().locator('[data-setup="reset"]');
  ok((await reset.textContent()).includes("Create"), "reset button says Create");
  await reset.click(); await pg.waitForTimeout(300);
  const auto = await pg.evaluate(() => window.__automation);
  ok(auto && auto.id === "skyfam_reset_chores" && auto.actions[0].repeat.for_each.join() === "todo.alex_s_chore_chart,todo.mia_chores,todo.leo_chores", "automation saved for every chore list: " + (auto && auto.actions[0].repeat.for_each));
  ok(auto.actions[0].repeat.sequence[2].variables.old.includes("regex_findall('\\d{4}-\\d{2}-\\d{2}')"), "date regex survives the JS string");
  ok((await reset.textContent()).includes("Update"), "reset button now says Update");
  await pg.screenshot({ path: `${out}/2-chores.png` });

  console.log(logs.filter((l) => l.includes("rror")).join("\n"));
  await b.close(); srv.close();
});
