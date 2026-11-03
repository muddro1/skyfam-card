// Drives the visual editor against the mock hass and checks the config it emits and the live preview.
const { chromium } = require("playwright"); const http = require("http"), fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, ".."); const out = process.argv[2] || "shots-editor"; fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split("?")[0])); r.writeHead(200, { "Content-Type": (p.endsWith(".js") ? "text/javascript" : "text/html") + "; charset=utf-8" }); fs.createReadStream(p).pipe(r); }).listen(8768, async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1500, height: 900 } });
  const logs = []; pg.on("console", (m) => logs.push(m.text())); pg.on("pageerror", (e) => logs.push("PAGEERROR " + e.message));
  const ed = () => pg.locator("skyfam-card-editor"); const card = () => pg.locator("skyfam-card");
  const last = () => pg.evaluate(() => window.__configs[window.__configs.length - 1]);
  const shot = async (n) => { await pg.waitForTimeout(250); await pg.screenshot({ path: `${out}/${n}.png` }); };
  const ok = (cond, msg) => console.log((cond ? "PASS " : "FAIL ") + msg);
  await pg.goto("http://localhost:8768/test/editor.html"); await pg.waitForTimeout(600);
  await shot("1-editor");

  await ed().locator('details[data-sec="people-2"] > summary').click(); await shot("2-person-open");
  await ed().locator('[data-slot="people-2"] input[name=name]').fill("Mia Rose");
  let c = await last(); ok(c.people[2].name === "Mia Rose", "rename person -> config");
  ok((await card().locator(".chip", { hasText: "Mia Rose" }).count()) === 1, "rename shows in preview");
  ok((await ed().locator('[data-name="people-2"]').textContent()) === "Mia Rose", "rename updates item header");

  await ed().locator('[data-color="people-2"]').evaluate((el) => { el.value = "#ff00aa"; el.dispatchEvent(new Event("input")); });
  c = await last(); ok(c.people[2].color === "#ff00aa", "color picker -> config");

  await ed().locator('[data-move="people-3-up"]').click();
  c = await last(); ok(c.people.map((p) => p.name).join() === "Alex,Jordan,Leo,Mia Rose", "move up reorders: " + c.people.map((p) => p.name).join());
  ok(await ed().locator('details[data-sec="people-3"]').evaluate((d) => d.open), "open state follows the moved item");

  await ed().locator('.add[data-add="people"]').click();
  c = await last(); ok(c.people.length === 5 && c.people[4].name === "Person 5" && !!c.people[4].color, "add person");
  await ed().locator('[data-slot="people-4"] input[name=name]').fill("Grandma");
  await ed().locator('[data-slot="people-4"] input[name=calendars]').fill("calendar.family");
  c = await last(); ok(c.people[4].name === "Grandma" && c.people[4].calendars[0] === "calendar.family", "new person fields");
  await shot("3-added");
  await ed().locator('[data-del="people-4"]').click();
  c = await last(); ok(c.people.length === 5, "first remove click only asks");
  await ed().locator('[data-del="people-4"]').click();
  c = await last(); ok(c.people.length === 4, "second click removes");

  await ed().locator('[data-slot="general"] select[name=theme]').selectOption("dark");
  c = await last(); ok(c.theme === "dark", "theme -> config");
  ok(await card().locator(".app").evaluate((a) => a.classList.contains("dark")), "preview goes dark");
  await ed().locator('[data-slot="general"] select[name=first_day]').selectOption("1");
  c = await last(); ok(c.first_day === 1, "first day Monday is numeric 1");

  await ed().locator('details[data-sec="planner"] > summary').click();
  await ed().locator('[data-slot="planner"] input[name=planner_start_hour]').fill("8");
  c = await last(); ok(c.planner_start_hour === 8, "planner start hour");
  await ed().locator('[data-slot="planner"] input[name=planner_start_hour]').fill("6");
  c = await last(); ok(!("planner_start_hour" in c), "default hour is dropped from YAML");

  await ed().locator('details[data-sec="chores"] > summary').click();
  await ed().locator('[data-slot="chores"] input[name=parent_pin]').fill("2468");
  c = await last(); ok(c.parent_pin === "2468", "parent pin");

  await ed().locator('details[data-sec="shared"] > summary').click();
  await ed().locator('details[data-sec="lists"] > summary').click();
  await ed().locator('.add[data-add="lists"]').click();
  await ed().locator('[data-slot="lists-2"] input[name=entity]').fill("todo.leo_chores");
  c = await last(); ok(c.lists.length === 3 && c.lists[2].entity === "todo.leo_chores", "add list");
  ok(c.shared[0].calendars[0] === "calendar.family" && !c.shared[0].entity, "shared entity normalized to calendars");
  await shot("4-sections");

  // the preview has been reconfigured many times; a tap must still fire exactly once
  await card().locator('.nav[data-v=chores]').click(); await pg.waitForTimeout(200);
  const before = logs.filter((l) => l.startsWith("SERVICE todo update_item")).length;
  await card().locator(".chore[data-act=chore]").first().click(); await pg.waitForTimeout(300);
  const after = logs.filter((l) => l.startsWith("SERVICE todo update_item")).length;
  ok(after - before === 1, `chore tap fires once after reconfigures (${after - before})`);
  ok((await card().locator(".kid").count()) === 2, "chore lists still subscribed after reconfigure");
  await ed().locator('details[data-sec="lists"] > summary').click();
  await shot("5-preview-chores");

  console.log("FINAL", JSON.stringify(await last()));
  console.log("STUB", JSON.stringify(await pg.evaluate(() => window.stub)));
  console.log(logs.filter((l) => l.includes("ERROR") || l.includes("rror")).join("\n"));
  await b.close(); srv.close();
});
