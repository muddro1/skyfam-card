/* SkyFam: a Skylight-style family hub card for Home Assistant.
 * Calendar, chores, lists. Uses only native HA entities:
 *   calendar.*  (events via REST), todo.* (subscribe), counter.* (stars), weather.*, person.*
 * One file, no build step.
 */
const SKYFAM_VERSION = "0.6.0";

const DAY_MS = 86400000;
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const EMOJI_RE = /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier}|\uFE0F)*)\s*/u;
const splitEmoji = (s) => { s = String(s || ""); const m = s.match(EMOJI_RE); return m ? [m[1], s.slice(m[0].length)] : ["", s]; };
const CHORE_EMOJI = ["🛏️", "🪥", "👕", "🧺", "🍽️", "🥄", "🧸", "🧹", "🗑️", "🐶", "🌱", "📚", "🎒", "🚿", "🧼", "🎹", "🏀", "💧"];
const REWARD_EMOJI = ["📱", "🎮", "🎬", "🍕", "🍦", "🍪", "🧁", "🎁", "💵", "🛝", "🏊", "🎨", "📖", "🌙", "🚲", "🧸"];
const parseLocalDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

const WEATHER_ICON = {
  "clear-night": "🌙", cloudy: "☁️", exceptional: "⚠️", fog: "🌫️", hail: "🌨️", lightning: "🌩️",
  "lightning-rainy": "⛈️", partlycloudy: "⛅", pouring: "🌧️", rainy: "🌦️", snowy: "❄️",
  "snowy-rainy": "🌨️", sunny: "☀️", windy: "💨", "windy-variant": "💨",
};
const NAV = [
  { id: "today", label: "Today", mdi: "mdi:home-heart", emoji: "🏠" },
  { id: "planner", label: "Planner", mdi: "mdi:calendar-account", emoji: "🧭" },
  { id: "week", label: "Week", mdi: "mdi:calendar-week", emoji: "🗓️" },
  { id: "month", label: "Month", mdi: "mdi:calendar-month", emoji: "📅" },
  { id: "chores", label: "Chores", mdi: "mdi:star-circle", emoji: "⭐" },
  { id: "lists", label: "Lists", mdi: "mdi:format-list-checks", emoji: "📝" },
];
const THEMES = [
  { id: "light", label: "Light", icon: "☀️" },
  { id: "dark", label: "Dark", icon: "🌙" },
  { id: "auto", label: "Auto", icon: "🌓" },
  { id: "sun", label: "Sunset", icon: "🌇" },
];
const PERIODS = [
  { id: "morning", label: "Morning", icon: "🌅" },
  { id: "afternoon", label: "Afternoon", icon: "☀️" },
  { id: "evening", label: "Evening", icon: "🌙" },
  { id: "anytime", label: "Anytime", icon: "✨" },
];

class SkyFamCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._view = "today";
    this._anchor = startOfDay(new Date()); // week/month anchor
    this._events = {}; // rangeKey -> {ts, events, loading}
    this._todos = {}; // entity -> items
    this._forecast = [];
    this._unsubs = [];
    this._hidden = new Set(this._load("hidden", []));
    this._listTab = 0;
    this._showDone = new Set();
    this._modal = null;
    this._lastTouch = Date.now();
    this._sig = "";
    this._editChores = false;
    this._unlockedUntil = 0;
  }

  /* ---------- config ---------- */
  setConfig(config) {
    if (!config || !Array.isArray(config.people)) throw new Error("skyfam-card: 'people' list is required");
    const norm = (c, i, shared) => {
      const o = typeof c === "string" ? { entity: c } : { ...c };
      o.calendars = o.calendars || (o.entity ? [o.entity] : []);
      o.name = o.name || (o.entity || o.calendars[0] || `Calendar ${i + 1}`).split(".").pop().replace(/_/g, " ");
      o.color = o.color || ["#7c9cbf", "#c99a6b", "#9d7cbf", "#6bb3a0", "#bf7c8f", "#a0a86b"][i % 6];
      o.key = (shared ? "s:" : "p:") + o.name;
      o.shared = !!shared;
      return o;
    };
    this._config = {
      title: "",
      first_day: 0,
      idle_return_minutes: 3,
      theme: "light",
      rewards: [],
      lists: [],
      ...config,
    };
    this._people = config.people.map((p, i) => norm(p, i, false));
    this._shared = (config.shared || []).map((p, i) => norm(p, i + this._people.length, true));
    this._lists = (config.lists || []).map((l) => (typeof l === "string" ? { entity: l } : l));
    this._calOwners = {};
    [...this._people, ...this._shared].forEach((o) => o.calendars.forEach((c) => (this._calOwners[c] = o)));
    if (config.default_view && config.default_view !== this._prevDefault) this._view = config.default_view;
    this._prevDefault = config.default_view;
    this._scrollNow = this._view === "planner";
    // live reconfigure (the visual editor calls setConfig on every change)
    const calSig = JSON.stringify(Object.keys(this._calOwners).sort());
    if (calSig !== this._calSig) { this._events = {}; this._calSig = calSig; }
    const subSig = JSON.stringify([this._todoEntities(), this._config.weather_entity || ""]);
    if (this._subSig && subSig !== this._subSig) this._teardown();
    this._subSig = subSig;
    this._sig = "";
    if (this._hass) {
      if (!this._built) this._build();
      const off = this._config.height_offset;
      if (off != null && off !== "") this.style.setProperty("--skyfam-offset", typeof off === "number" ? off + "px" : off);
      if (!this._subscribed) this._subscribe();
      this._render();
    }
  }

  _todoEntities() {
    return [...new Set([...this._lists.map((l) => l.entity), ...this._people.map((p) => p.chores), this._config.rewards_list, this._config.rewards_owed_list].filter(Boolean))];
  }
  _teardown() {
    this._unsubs.forEach((u) => { try { Promise.resolve(u).then((f) => f && f()); } catch (e) {} });
    this._unsubs = [];
    this._subscribed = false;
  }

  // HA sets this on cards shown in the card editor preview and in dashboard edit mode
  set preview(v) { this._preview = !!v; this.toggleAttribute("preview", this._preview); }
  get preview() { return !!this._preview; }

  static getConfigElement() { return document.createElement("skyfam-card-editor"); }

  getCardSize() { return 12; }
  getGridOptions() { return { columns: "full", rows: "auto" }; }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._built) this._build();
    this._applyTheme();
    if (first || !this._subscribed) this._subscribe();
    const sig = this._stateSig();
    if (sig !== this._sig) {
      this._sig = sig;
      this._render();
    }
  }

  _themeMode() { return this._load("theme", null) || this._config.theme || "light"; }
  _isDark() {
    const m = this._themeMode();
    if (m === "dark") return true;
    if (m === "auto") return !!(this._hass && this._hass.themes && this._hass.themes.darkMode);
    if (m === "sun") { const s = this._hass && this._hass.states["sun.sun"]; return !!s && s.state === "below_horizon"; }
    return false;
  }
  _applyTheme() {
    const app = this.shadowRoot && this.shadowRoot.querySelector(".app");
    if (app) app.classList.toggle("dark", this._isDark());
  }

  _fit() {
    if (this._config && this._config.height_offset != null && this._config.height_offset !== "") return;
    const top = Math.max(0, Math.round(this.getBoundingClientRect().top + (window.scrollY || 0)));
    this.style.setProperty("--skyfam-offset", top + "px");
  }

  connectedCallback() {
    this._tick = setInterval(() => this._onTick(), 15000);
    this._onResize = () => requestAnimationFrame(() => this._fit());
    window.addEventListener("resize", this._onResize);
    setTimeout(this._onResize, 50); setTimeout(this._onResize, 800);
    if (this._hass && !this._subscribed) this._subscribe();
  }
  disconnectedCallback() {
    clearInterval(this._tick);
    window.removeEventListener("resize", this._onResize);
    this._teardown();
  }

  _stateSig() {
    const h = this._hass;
    const ids = [this._config.weather_entity, "sun.sun", ...this._people.map((p) => p.person), ...this._people.map((p) => p.stars)].filter(Boolean);
    return ids.map((id) => { const s = h.states[id]; return s ? s.state + (s.attributes.temperature ?? "") + (s.attributes.entity_picture || "") : "-"; }).join("|");
  }

  _load(k, d) { try { const v = localStorage.getItem("skyfam:" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  _save(k, v) { try { localStorage.setItem("skyfam:" + k, JSON.stringify(v)); } catch (e) {} }

  /* ---------- data ---------- */
  _subscribe() {
    if (!this._hass || !this._hass.connection || !this.isConnected) return;
    this._subscribed = true;
    const conn = this._hass.connection;
    this._todos = {};
    this._forecast = [];
    this._todoEntities().forEach((entity) => {
      const u = conn.subscribeMessage((msg) => { this._todos[entity] = msg.items || []; this._render(); },
        { type: "todo/item/subscribe", entity_id: entity }).catch((e) => console.warn("skyfam todo", entity, e));
      this._unsubs.push(u);
    });
    if (this._config.weather_entity) {
      const u = conn.subscribeMessage((msg) => { this._forecast = msg.forecast || []; this._render(); },
        { type: "weather/subscribe_forecast", forecast_type: "daily", entity_id: this._config.weather_entity }).catch(() => {});
      this._unsubs.push(u);
    }
  }

  _range() {
    const today = startOfDay(new Date());
    if (this._view === "planner") {
      const d = startOfDay(this._anchor);
      return [d, addDays(d, 1)];
    }
    if (this._view === "week") {
      const s = this._weekStart(this._anchor);
      return [s, addDays(s, 7)];
    }
    if (this._view === "month") {
      const first = new Date(this._anchor.getFullYear(), this._anchor.getMonth(), 1);
      const s = this._weekStart(first);
      const dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      this._weeks = Math.ceil((Math.round((first - s) / DAY_MS) + dim) / 7);
      return [s, addDays(s, this._weeks * 7)];
    }
    return [today, addDays(today, 3)];
  }
  _weekStart(d) {
    const fd = Number(this._config.first_day) || 0;
    const diff = (d.getDay() - fd + 7) % 7;
    return addDays(startOfDay(d), -diff);
  }

  _eventsFor(start, end) {
    const key = ymd(start) + "_" + ymd(end);
    const c = this._events[key];
    const fresh = c && Date.now() - c.ts < 5 * 60000;
    if (!fresh && !(c && c.loading)) this._fetch(key, start, end);
    return c ? c.events : null;
  }

  async _fetch(key, start, end) {
    const prev = this._events[key];
    this._events[key] = { ts: prev ? prev.ts : 0, events: prev ? prev.events : null, loading: true };
    const cals = [...new Set([...this._people, ...this._shared].flatMap((o) => o.calendars))];
    const results = await Promise.all(cals.map((cal) =>
      this._hass.callApi("GET", `calendars/${cal}?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`)
        .then((evs) => evs.map((e) => this._normEvent(e, cal)))
        .catch((e) => { console.warn("skyfam calendar", cal, e); return []; })));
    const seen = new Set();
    const events = results.flat().filter((e) => { const k = e.calendar + e.uid + e.start.getTime(); if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start));
    this._events[key] = { ts: Date.now(), events, loading: false };
    this._render();
  }

  _normEvent(e, cal) {
    const allDay = !!(e.start && e.start.date);
    const start = allDay ? parseLocalDate(e.start.date) : new Date(e.start.dateTime);
    const end = allDay ? parseLocalDate(e.end.date) : new Date(e.end.dateTime);
    let owner = this._calOwners[cal];
    let title = e.summary || "(no title)";
    // "[Ethan] - Wrestling" -> owner Ethan, title "Wrestling"
    const m = title.match(/^\s*\[([^\]]+)\]\s*[-–:]?\s*(.*)$/);
    if (m) {
      const p = this._people.find((x) => x.name.toLowerCase() === m[1].trim().toLowerCase());
      if (p) { owner = p; title = m[2] || title; }
    }
    return {
      uid: e.uid || e.summary, title, rawTitle: e.summary, start, end, allDay,
      location: e.location || "", description: e.description || "",
      calendar: cal, owner, color: owner ? owner.color : "#999",
    };
  }

  _visible(events) {
    return (events || []).filter((e) => !e.owner || !this._hidden.has(e.owner.key));
  }
  _onDay(events, day) {
    const ds = startOfDay(day), de = addDays(ds, 1);
    return events.filter((e) => e.start < de && (e.end > ds || (+e.end === +e.start && e.start >= ds)));
  }

  /* ---------- actions ---------- */
  async _svc(domain, service, data, target) {
    try { await this._hass.callService(domain, service, data, target); }
    catch (e) { this._toast(`Couldn't save: ${e.message || e}`); throw e; }
  }

  _parseChore(item) {
    const d = `${item.description || ""} ${item.summary || ""}`;
    const sm = d.match(/(\d+)\s*⭐|⭐\s*(\d+)/);
    const stars = sm ? Number(sm[1] || sm[2]) : 0;
    const pm = (item.description || "").toLowerCase().match(/morning|afternoon|evening|night|anytime/);
    let period = pm ? pm[0] : "anytime";
    if (period === "night") period = "evening";
    return { ...item, stars, period, done: item.status === "completed" };
  }

  async _toggleChore(person, uid) {
    const items = (this._todos[person.chores] || []).map((i) => this._parseChore(i));
    const it = items.find((i) => i.uid === uid);
    if (!it) return;
    const toDone = !it.done;
    // optimistic
    const raw = this._todos[person.chores].find((i) => i.uid === uid);
    raw.status = toDone ? "completed" : "needs_action";
    this._render();
    await this._svc("todo", "update_item", { item: uid, status: raw.status }, { entity_id: person.chores });
    if (it.stars && person.stars && this._hass.states[person.stars]) {
      const cur = Number(this._hass.states[person.stars].state) || 0;
      await this._svc("counter", "set_value", { value: Math.max(0, cur + (toDone ? it.stars : -it.stars)) }, { entity_id: person.stars });
    }
    if (toDone) {
      const left = items.filter((i) => i.uid !== uid && !i.done).length;
      this._celebrate(left === 0 ? `🎉 ${person.name} finished everything!` : it.stars ? `Nice job! +${it.stars} ⭐` : "Nice job! ✓", left === 0);
    }
  }

  async _toggleTodo(entity, uid) {
    const raw = (this._todos[entity] || []).find((i) => i.uid === uid);
    if (!raw) return;
    raw.status = raw.status === "completed" ? "needs_action" : "completed";
    this._render();
    await this._svc("todo", "update_item", { item: uid, status: raw.status }, { entity_id: entity });
  }

  async _addTodo(entity, text) {
    if (!text.trim()) return;
    await this._svc("todo", "add_item", { item: text.trim() }, { entity_id: entity });
  }

  async _createEvent(f) {
    const owner = [...this._people, ...this._shared].find((o) => o.key === f.who);
    if (!owner || !f.title.trim()) { this._toast("Add a title and pick who it's for"); return false; }
    const cal = owner.add_calendar || owner.calendars[0];
    let summary = f.title.trim();
    if (owner.prefix_titles && !summary.startsWith("[")) summary = `[${owner.name}] - ${summary}`;
    const data = { summary };
    if (f.location) data.location = f.location;
    if (f.allDay) {
      data.start_date = f.date;
      data.end_date = ymd(addDays(parseLocalDate(f.date), 1));
    } else {
      data.start_date_time = `${f.date} ${f.start}:00`;
      data.end_date_time = `${f.date} ${f.end}:00`;
    }
    await this._svc("calendar", "create_event", data, { entity_id: cal });
    this._events = {};
    this._render();
    return true;
  }

  _rewards() {
    const ent = this._config.rewards_list;
    if (ent) {
      return (this._todos[ent] || []).map((i) => {
        const [icon, name] = splitEmoji(i.summary);
        const m = `${i.description || ""}`.match(/(\d+)/);
        return { uid: i.uid, icon: icon || "🎁", name: name || i.summary, cost: m ? Number(m[1]) : 0 };
      }).sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
    }
    return (this._config.rewards || []).map((r) => ({ ...r }));
  }

  // Redeemed rewards waiting to be given: "🍕 Pick dinner" / "Ethan · 10⭐ · redeemed Nov 3"
  _owed() {
    const ent = this._config.rewards_owed_list;
    if (!ent) return null;
    return (this._todos[ent] || []).map((i) => {
      const [icon, name] = splitEmoji(i.summary);
      const d = i.description || "";
      const kid = d.split("·")[0].trim();
      const m = d.match(/(\d+)\s*⭐/);
      const w = d.match(/redeemed\s+(.+)$/i);
      const person = this._people.find((x) => x.name.toLowerCase() === kid.toLowerCase());
      return { uid: i.uid, icon: icon || "🎁", name: name || i.summary, kid, person, cost: m ? Number(m[1]) : 0, when: w ? w[1].trim() : "", done: i.status === "completed" };
    });
  }

  _owedPanel() {
    const owed = this._owed();
    if (!owed) return "";
    const ent = this._config.rewards_owed_list;
    const open = owed.filter((o) => !o.done), given = owed.filter((o) => o.done);
    const row = (o) => `<div class="owed-row ${o.done ? "done" : ""}" style="--c:${o.person ? o.person.color : "var(--accent)"}">
      <span class="ri">${esc(o.icon)}</span><span class="on"><b>${esc(o.name)}</b><small><span class="kidtag">${esc(o.kid || "?")}</span>${o.cost ? ` · ${o.cost}⭐` : ""}${o.when ? ` · ${esc(o.when)}` : ""}</small></span>
      ${o.done ? `<button class="btn sm" data-act="owed-undo" data-uid="${esc(o.uid)}">Undo</button>`
        : `<button class="btn sm" data-act="owed-refund" data-uid="${esc(o.uid)}" title="Cancel and give the stars back">↩</button><button class="btn primary sm" data-act="owed-give" data-uid="${esc(o.uid)}">✓ Given</button>`}</div>`;
    const show = this._showDone.has(ent);
    return `<div class="owed card"><h2>🎁 Owed <span class="cnt">${open.length}</span></h2>
      <div class="owed-list">${open.map(row).join("") || `<div class="empty small">Nothing owed right now</div>`}</div>
      ${given.length ? `<button class="showdone" data-act="showdone" data-e="${esc(ent)}">${show ? "Hide" : "Show"} given (${given.length})</button>${show ? `<div class="owed-list">${given.map(row).join("")}</div>` : ""}` : ""}</div>`;
  }

  // Optional parent PIN (config parent_pin) guards editing; stays unlocked for 5 minutes.
  _gate(fn) {
    const pin = this._config.parent_pin;
    if (!pin || Date.now() < this._unlockedUntil) return fn();
    this._openModal({ type: "pin", then: fn, entered: "" });
  }

  async _saveChore(f) {
    const name = f.name.trim();
    if (!name) { this._toast("Give the chore a name"); return false; }
    const summary = (f.emoji.trim() ? f.emoji.trim() + " " : "") + name;
    const description = f.period + (f.stars > 0 ? ` ${f.stars}⭐` : "");
    if (f.uid) {
      const p = this._people.find((x) => x.name === f.person);
      await this._svc("todo", "update_item", { item: f.uid, rename: summary, description }, { entity_id: p.chores });
    } else {
      const kids = this._people.filter((x) => x.chores && f.kids.includes(x.name));
      if (!kids.length) { this._toast("Pick who the chore is for"); return false; }
      for (const p of kids) await this._svc("todo", "add_item", { item: summary, description }, { entity_id: p.chores });
    }
    return true;
  }

  async _saveReward(f) {
    const ent = this._config.rewards_list;
    const name = f.name.trim();
    const cost = Math.max(1, Math.round(Number(f.cost) || 0));
    if (!name) { this._toast("Give the reward a name"); return false; }
    const summary = (f.emoji.trim() ? f.emoji.trim() + " " : "") + name;
    if (f.uid) await this._svc("todo", "update_item", { item: f.uid, rename: summary, description: `${cost}⭐` }, { entity_id: ent });
    else await this._svc("todo", "add_item", { item: summary, description: `${cost}⭐` }, { entity_id: ent });
    return true;
  }

  /* ---------- shell ---------- */
  _build() {
    this._built = true;
    const off = this._config.height_offset;
    if (off != null && off !== "") this.style.setProperty("--skyfam-offset", typeof off === "number" ? off + "px" : off);
    this.shadowRoot.innerHTML = `<style>${SKYFAM_CSS}</style>
      <div class="app">
        <nav class="rail"></nav>
        <main class="main"><header class="top"></header><section class="body"></section></main>
        <button class="fab" data-act="add-event" title="Add event">＋</button>
        <div class="modal-host"></div><div class="toast"></div><div class="confetti"></div>
      </div>`;
    const root = this.shadowRoot;
    if (this._listening) return;
    this._listening = true;
    root.addEventListener("click", (e) => this._onClick(e));
    root.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.dataset && e.target.dataset.add) {
        const v = e.target.value; e.target.value = ""; this._addTodo(e.target.dataset.add, v);
      }
    });
    root.addEventListener("pointerdown", () => (this._lastTouch = Date.now()), { passive: true });
  }

  _icon(n) {
    return customElements.get("ha-icon") ? `<ha-icon icon="${n.mdi}"></ha-icon>` : `<span class="emo">${n.emoji}</span>`;
  }

  _onTick() {
    const t = this.shadowRoot.querySelector(".clock");
    if (t) t.innerHTML = this._timeStr(new Date());
    const idle = (Number(this._config.idle_return_minutes) || 0) * 60000;
    if (idle && Date.now() - this._lastTouch > idle && (this._view !== (this._config.default_view || "today") || this._modal)) {
      this._view = this._config.default_view || "today";
      this._anchor = startOfDay(new Date());
      this._modal = null;
      this._scrollNow = this._view === "planner";
      this._render();
    }
    // day rollover / periodic refresh
    if (this._dayKey !== ymd(new Date())) { this._dayKey = ymd(new Date()); this._events = {}; this._render(); }
  }

  _timeStr(d) { return esc(d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })).replace(/\s?([AP]M)/i, "<small>$1</small>"); }

  _render() {
    if (!this._built || !this._hass) return;
    const root = this.shadowRoot;
    // keep focused input across re-render
    const act = root.activeElement;
    const keep = act && act.dataset && act.dataset.keep ? { k: act.dataset.keep, v: act.value, s: act.selectionStart } : null;
    const body = root.querySelector(".body");
    const scroll = body ? body.scrollTop : 0;

    root.querySelector(".rail").innerHTML = NAV.map((n) =>
      `<button class="nav ${this._view === n.id ? "on" : ""}" data-act="view" data-v="${n.id}">${this._icon(n)}<span>${n.label}</span></button>`).join("");
    root.querySelector(".top").innerHTML = this._renderTop();
    let html = "";
    try {
      html = this[`_view_${this._view}`] ? this[`_view_${this._view}`]() : "";
    } catch (e) { console.error(e); html = `<div class="empty">Something went wrong: ${esc(e.message)}</div>`; }
    body.innerHTML = html;
    body.className = `body v-${this._view}`;
    if (this._prevView === this._view) body.scrollTop = scroll;
    this._prevView = this._view;
    root.querySelector(".fab").style.display = ["today", "planner", "week", "month"].includes(this._view) ? "" : "none";
    this._applyTheme();
    if (this._view === "planner" && this._scrollNow && root.querySelector(".pl-scroll")) { this._scrollNow = false; requestAnimationFrame(() => this._scrollPlannerToNow()); }
    this._renderModal();
    if (keep) {
      const el = root.querySelector(`[data-keep="${keep.k}"]`);
      if (el) { el.value = keep.v; el.focus(); try { el.setSelectionRange(keep.s, keep.s); } catch (e) {} }
    }
    // inline clock text uses html
    const c = root.querySelector(".clock"); if (c) c.innerHTML = this._timeStr(new Date());
  }

  _renderTop() {
    const now = new Date();
    const w = this._config.weather_entity && this._hass.states[this._config.weather_entity];
    const today = this._forecast[0];
    const weather = w ? `<div class="wx"><span class="wx-i">${WEATHER_ICON[w.state] || "🌡️"}</span><span class="wx-t">${Math.round(w.attributes.temperature)}°</span>${today ? `<span class="wx-hl">${Math.round(today.temperature)}° / ${Math.round(today.templow)}°</span>` : ""}</div>` : "";
    const chips = [...this._people, ...this._shared].map((p) => {
      return `<button class="chip ${this._hidden.has(p.key) ? "off" : ""}" data-act="filter" data-k="${esc(p.key)}" style="--c:${p.color}">
        ${this._avatar(p)}${esc(p.name)}</button>`;
    }).join("");
    const tm = THEMES.find((t) => t.id === this._themeMode()) || THEMES[0];
    const themeBtn = `<button class="themebtn" data-act="theme" title="Theme: ${tm.label}">${tm.icon}<span>${tm.label}</span></button>`;
    return `<div class="when"><div class="clock"></div><div class="date">${now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</div></div>
      ${this._config.title ? `<div class="title">${esc(this._config.title)}</div>` : ""}
      ${weather}${themeBtn}
      <div class="chips">${["today", "planner", "week", "month"].includes(this._view) ? chips : ""}</div>`;
  }

  /* ---------- views ---------- */
  _evPill(e, opts = {}) {
    const time = e.allDay ? "" : `<b>${this._fmtTime(e.start)}</b> `;
    return `<button class="pill ${e.allDay ? "allday" : ""} ${opts.past ? "past" : ""}" style="--c:${e.color}" data-act="event" data-id="${esc(this._evId(e))}">${time}${esc(e.title)}</button>`;
  }
  _evId(e) { return e.calendar + "|" + e.uid + "|" + e.start.getTime(); }
  _fmtTime(d) { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(":00", "").replace(/\s?([AP])M/i, (m, a) => a.toLowerCase()); }

  _view_today() {
    const [s, e] = this._range();
    const events = this._eventsFor(s, e);
    const now = new Date();
    const vis = this._visible(events);
    const dayBlock = (day, label) => {
      const list = this._onDay(vis, day);
      const rows = list.length ? list.map((ev) => {
        const past = !ev.allDay && ev.end < now;
        const nowOn = !ev.allDay && ev.start <= now && ev.end > now;
        return `<button class="agenda ${past ? "past" : ""} ${nowOn ? "now" : ""}" style="--c:${ev.color}" data-act="event" data-id="${esc(this._evId(ev))}">
          <span class="a-time">${ev.allDay ? "All day" : `${this._fmtTime(ev.start)}<small>${this._fmtTime(ev.end)}</small>`}</span>
          <span class="a-bar"></span>
          <span class="a-main"><span class="a-title">${esc(ev.title)}</span>${ev.location ? `<span class="a-loc">📍 ${esc(ev.location.split(",")[0])}</span>` : ""}</span>
          ${ev.owner ? `<span class="a-who" style="--c:${ev.color}">${esc(ev.owner.name)}</span>` : ""}
        </button>`;
      }).join("") : `<div class="empty small">Nothing planned</div>`;
      return `<div class="day-block"><h3>${label}</h3>${rows}</div>`;
    };
    const sched = events === null ? `<div class="empty">Loading calendar…</div>` :
      dayBlock(now, "Today") + dayBlock(addDays(now, 1), "Tomorrow") + dayBlock(addDays(now, 2), addDays(now, 2).toLocaleDateString([], { weekday: "long" }));
    const kids = this._people.filter((p) => p.chores);
    const chores = kids.map((p) => {
      const items = (this._todos[p.chores] || []).map((i) => this._parseChore(i));
      const done = items.filter((i) => i.done).length;
      const next = items.filter((i) => !i.done).slice(0, 4);
      return `<div class="kid-mini" style="--c:${p.color}">
        <div class="km-head">${this._ring(done, items.length, p)}<div><b>${esc(p.name)}</b><span>${done} of ${items.length} done${this._starsBadge(p)}</span></div></div>
        ${next.map((i) => `<button class="chore-row" data-act="chore" data-p="${esc(p.name)}" data-uid="${esc(i.uid)}"><span class="chk"></span>${esc(i.summary)}</button>`).join("") || `<div class="empty small">All done! 🎉</div>`}
      </div>`;
    }).join("");
    // lists marked "today: true" stack in the third column; without any, the first list shows
    const flagged = this._lists.filter((l) => l.today);
    const todayLists = flagged.length ? flagged : this._lists.slice(0, 1);
    const limit = todayLists.length > 1 ? Number(this._config.today_list_items) || 5 : 0;
    return `<div class="col sched card"><h2>Schedule</h2>${sched}</div>
      <div class="col card"><h2 data-act="view" data-v="chores" class="link">Chores ›</h2>${chores || `<div class="empty small">No chore lists set up</div>`}</div>
      <div class="col lists-col">${todayLists.map((l) => `<div class="card ${limit ? "stacked" : ""}">${this._listPanel(l, true, limit)}</div>`).join("")}</div>`;
  }

  _ring(done, total, p) {
    const pct = total ? done / total : 0;
    const r = 22, c = 2 * Math.PI * r;
    const pic = this._pic(p);
    return `<span class="ringw"><svg class="ring" viewBox="0 0 54 54"><circle cx="27" cy="27" r="${r}" class="ring-bg"/><circle cx="27" cy="27" r="${r}" class="ring-fg" stroke="${p.color}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/>${pic ? "" : `<text x="27" y="32" text-anchor="middle">${esc(this._initials(p))}</text>`}</svg>${pic ? `<img src="${esc(pic)}" alt="">` : ""}</span>`;
  }

  _initials(p) { return (p.initials || p.name[0] || "?").toUpperCase(); }
  // Photo: per-person "picture" URL, else the person entity's own picture
  _pic(p) {
    if (!p || this._config.hide_pictures) return null;
    if (p.picture) return p.picture;
    const ps = p.person && this._hass.states[p.person];
    return (ps && ps.attributes.entity_picture) || null;
  }
  _avatar(p) {
    const pic = this._pic(p);
    const ps = p.person && this._hass.states[p.person];
    // no dot for people without a tracker (state unknown)
    const dot = ps && !["unknown", "unavailable"].includes(ps.state) ? `<i class="dot ${ps.state === "home" ? "home" : "away"}"></i>` : "";
    return `<span class="av ${pic ? "pic" : ""}" ${pic ? `style="background-image:url('${esc(pic)}')"` : ""}>${pic ? "" : esc(this._initials(p))}${dot}</span>`;
  }
  _starsBadge(p) {
    const s = p.stars && this._hass.states[p.stars];
    const n = (this._owed() || []).filter((o) => !o.done && o.person === p).length;
    return (s ? ` · <span class="stars">⭐ ${esc(s.state)}</span>` : "") + (n ? ` · 🎁 ${n} owed` : "");
  }

  _dayHead(d) {
    const fc = this._forecast.find((f) => sameDay(new Date(f.datetime), d));
    const isToday = sameDay(d, new Date());
    return `<div class="dh ${isToday ? "today" : ""}"><span class="dn">${d.toLocaleDateString([], { weekday: "short" })}</span><span class="dd">${d.getDate()}</span>${fc ? `<span class="df">${WEATHER_ICON[fc.condition] || ""} ${Math.round(fc.temperature)}°</span>` : ""}</div>`;
  }

  _navBar(label) {
    return `<div class="navbar"><button class="nb" data-act="prev">‹</button><button class="nb today-btn" data-act="today">Today</button><button class="nb" data-act="next">›</button><h2>${label}</h2></div>`;
  }

  _plannerCols() {
    const cols = this._people.filter((p) => !this._hidden.has(p.key)).map((p) => ({ key: p.key, name: p.name, color: p.color, owner: p, initials: p.initials }));
    const shared = this._shared.filter((s) => !this._hidden.has(s.key));
    if (shared.length) cols.push({ key: "shared", name: this._config.planner_shared_name || shared[0].name, color: shared[0].color, shared: true });
    return cols;
  }

  _view_planner() {
    const day = startOfDay(this._anchor);
    const events = this._eventsFor(...this._range());
    const now = new Date();
    const H = Number(this._config.planner_hour_height) || 64;
    const h0 = Math.max(0, Math.min(23, Number(this._config.planner_start_hour ?? 6)));
    const h1 = Math.max(h0 + 1, Math.min(24, Number(this._config.planner_end_hour ?? 22)));
    const cols = this._plannerCols();
    const label = day.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    if (events === null) return this._navBar(label) + `<div class="empty">Loading…</div>`;
    const list = this._onDay(this._visible(events), day);
    const colOf = (e) => (!e.owner || e.owner.shared ? "shared" : e.owner.key);
    const ds = +day;
    const hourRows = [...Array(h1 - h0)].map((_, i) => `<div class="pl-hr" style="top:${i * H}px"><span>${new Date(ds + (h0 + i) * 3600000).toLocaleTimeString([], { hour: "numeric" }).replace(/\s?([AP])M/i, (m, a) => a.toLowerCase())}</span></div>`).join("");
    const allCells = [];
    const body = cols.map((c) => {
      const mine = list.filter((e) => colOf(e) === c.key);
      const allDay = mine.filter((e) => e.allDay);
      const timed = mine.filter((e) => !e.allDay).map((e) => {
        const st = Math.max((e.start - ds) / 3600000, h0), en = Math.min((e.end - ds) / 3600000, h1);
        return { e, st, en: Math.max(en, st + 0.4) };
      }).filter((x) => x.st < h1 && x.en > h0).sort((a, b) => a.st - b.st || b.en - a.en);
      // lay out overlapping events side by side
      let cluster = [], clusterEnd = -1;
      const flush = () => { const lanes = Math.max(...cluster.map((x) => x.lane)) + 1; cluster.forEach((x) => (x.lanes = lanes)); cluster = []; };
      timed.forEach((x) => {
        if (x.st >= clusterEnd && cluster.length) flush();
        const used = new Set(cluster.filter((y) => y.en > x.st).map((y) => y.lane));
        let lane = 0; while (used.has(lane)) lane++;
        x.lane = lane; cluster.push(x); clusterEnd = Math.max(clusterEnd, x.en);
      });
      if (cluster.length) flush();
      const blocks = timed.map(({ e, st, en, lane, lanes }) => {
        const top = (st - h0) * H, height = Math.max((en - st) * H - 3, 24);
        const past = e.end < now;
        return `<button class="pl-ev ${past ? "past" : ""} ${height < 44 ? "short" : ""}" style="--c:${e.color};top:${top}px;height:${height}px;left:calc(${(lane / lanes) * 100}% + 3px);width:calc(${100 / lanes}% - 6px)" data-act="event" data-id="${esc(this._evId(e))}">
          <b>${esc(e.title)}</b><span>${this._fmtTime(e.start)} – ${this._fmtTime(e.end)}${e.location ? ` · ${esc(e.location.split(",")[0])}` : ""}</span></button>`;
      }).join("");
      const slots = [...Array(h1 - h0)].map((_, i) => `<div class="pl-slot" style="top:${i * H}px;height:${H}px" data-act="slot" data-h="${h0 + i}" data-who="${esc(c.shared ? (this._shared[0] || {}).key || "" : c.key)}"></div>`).join("");
      allCells.push(`<div class="pl-all" style="--c:${c.color}">${allDay.map((e) => this._evPill(e)).join("")}</div>`);
      return `<div class="pl-col" style="--c:${c.color}"><div class="pl-grid" style="height:${(h1 - h0) * H}px">${slots}${blocks}</div></div>`;
    }).join("");
    const heads = cols.map((c) => {
      return `<div class="pl-head" style="--c:${c.color}">${this._avatar(c.owner || { name: c.name, color: c.color })}<b>${esc(c.name)}</b></div>`;
    }).join("");
    const nowLine = sameDay(day, now) && now.getHours() + now.getMinutes() / 60 >= h0 && now.getHours() < h1
      ? `<div class="pl-now" style="top:${(now.getHours() + now.getMinutes() / 60 - h0) * H}px"></div>` : "";
    const tmpl = `var(--plt, 64px) repeat(${cols.length}, minmax(var(--plc, 150px), 1fr))`;
    return this._navBar(label) + `<div class="planner"><div class="pl-scroll">
      <div class="pl-top">
        <div class="pl-heads" style="grid-template-columns:${tmpl}"><div></div>${heads}</div>
        <div class="pl-allrow" style="grid-template-columns:${tmpl}"><div class="pl-all-label">All day</div>${allCells.join("")}</div>
      </div>
      <div class="pl-body" style="grid-template-columns:${tmpl}">
        <div class="pl-times"><div class="pl-grid" style="height:${(h1 - h0) * H}px">${hourRows}</div></div>
        ${body}${nowLine}</div></div></div>`;
  }

  _scrollPlannerToNow() {
    const sc = this.shadowRoot.querySelector(".pl-scroll");
    if (!sc) return;
    const top = this.shadowRoot.querySelector(".pl-top");
    const head = top ? top.offsetHeight : 0;
    const line = this.shadowRoot.querySelector(".pl-now");
    const evs = [...this.shadowRoot.querySelectorAll(".pl-ev")].map((e) => e.offsetTop);
    const target = line ? line.offsetTop : evs.length ? Math.min(...evs) : 0;
    sc.scrollTop = Math.max(0, target + head - 140);
  }

  _view_week() {
    const [s, e] = this._range();
    const events = this._eventsFor(s, e);
    const vis = this._visible(events);
    const now = new Date();
    const days = [...Array(7)].map((_, i) => addDays(s, i));
    const label = `${s.toLocaleDateString([], { month: "short", day: "numeric" })} – ${addDays(s, 6).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;
    const cols = days.map((d) => {
      const list = this._onDay(vis, d);
      const isPast = startOfDay(d) < startOfDay(now);
      return `<div class="wcol ${sameDay(d, now) ? "today" : ""} ${isPast ? "pastday" : ""}">${this._dayHead(d)}
        <div class="wlist">${list.map((ev) => this._evPill(ev, { past: !ev.allDay && ev.end < now })).join("")}</div>
        <button class="wadd" data-act="add-event" data-date="${ymd(d)}">＋</button></div>`;
    }).join("");
    return this._navBar(label) + (events === null ? `<div class="empty">Loading…</div>` : `<div class="week">${cols}</div>`);
  }

  _view_month() {
    const [s] = this._range();
    const events = this._eventsFor(...this._range());
    const vis = this._visible(events);
    const now = new Date();
    const m = this._anchor.getMonth();
    const heads = [...Array(7)].map((_, i) => `<div class="mh">${addDays(s, i).toLocaleDateString([], { weekday: "short" })}</div>`).join("");
    const cells = [...Array(this._weeks * 7)].map((_, i) => {
      const d = addDays(s, i);
      const list = this._onDay(vis, d);
      const more = list.length > 3 ? `<span class="more">+${list.length - 3} more</span>` : "";
      return `<div class="mc ${d.getMonth() !== m ? "out" : ""} ${sameDay(d, now) ? "today" : ""}" data-act="day" data-date="${ymd(d)}">
        <span class="mcd">${d.getDate()}</span>${list.slice(0, 3).map((ev) => `<span class="mp" style="--c:${ev.color}">${ev.allDay ? "" : `<b>${this._fmtTime(ev.start)}</b> `}${esc(ev.title)}</span>`).join("")}${more}</div>`;
    }).join("");
    const label = this._anchor.toLocaleDateString([], { month: "long", year: "numeric" });
    return this._navBar(label) + (events === null ? `<div class="empty">Loading…</div>` : `<div class="month" style="grid-template-rows:auto repeat(${this._weeks}, minmax(78px, 1fr))">${heads}${cells}</div>`);
  }

  _view_chores() {
    const kids = this._people.filter((p) => p.chores);
    if (!kids.length) return `<div class="empty">Add <code>chores: todo.xxx</code> to a person to show chores here.</div>`;
    const ed = this._editChores;
    const bar = `<div class="chorebar"><button class="btn primary" data-act="chore-add">＋ Add chore</button>
      <button class="btn ${ed ? "on" : ""}" data-act="chore-edit">${ed ? "✓ Done editing" : "✏️ Edit chores"}</button>
      ${this._config.rewards_list ? `<button class="btn" data-act="rewards-edit">🎁 Edit rewards</button>` : ""}</div>`;
    return bar + `<div class="chores ${ed ? "editing" : ""}">${kids.map((p) => {
      const items = (this._todos[p.chores] || []).map((i) => this._parseChore(i));
      const done = items.filter((i) => i.done).length;
      const groups = PERIODS.map((per) => {
        const g = items.filter((i) => i.period === per.id);
        if (!g.length) return "";
        return `<div class="per"><h4>${per.icon} ${per.label}</h4>${g.map((i) => `
          <button class="chore ${i.done ? "done" : ""}" data-act="${ed ? "chore-open" : "chore"}" data-p="${esc(p.name)}" data-uid="${esc(i.uid)}">
            <span class="chk">${i.done ? "✓" : ""}</span><span class="ct">${esc(i.summary)}</span>${i.stars ? `<span class="cs">${i.stars}⭐</span>` : ""}${ed ? `<span class="pen">✏️</span>` : ""}</button>`).join("")}</div>`;
      }).join("");
      const stars = p.stars && this._hass.states[p.stars];
      return `<div class="kid card" style="--c:${p.color}">
        <div class="kid-head">${this._ring(done, items.length, p)}<div class="kh-txt"><b>${esc(p.name)}</b><span>${done} of ${items.length} done today</span></div>
        ${stars ? `<button class="bank" data-act="rewards" data-p="${esc(p.name)}">⭐ ${esc(stars.state)}<small>Rewards</small></button>` : ""}</div>
        <div class="kid-body">${groups || `<div class="empty small">No chores yet</div>`}
        ${ed || !groups ? `<button class="addrow" data-act="chore-add" data-p="${esc(p.name)}">＋ Add a chore for ${esc(p.name)}</button>` : ""}</div></div>`;
    }).join("")}${this._owedPanel()}</div>`;
  }

  _listPanel(l, compact, limit = 0) {
    const items = this._todos[l.entity];
    const name = l.name || (this._hass.states[l.entity] && this._hass.states[l.entity].attributes.friendly_name) || l.entity;
    if (!items) return `<h2>${esc(name)}</h2><div class="empty small">Loading…</div>`;
    const open = items.filter((i) => i.status !== "completed");
    const done = items.filter((i) => i.status === "completed");
    const row = (i) => `<button class="todo ${i.status === "completed" ? "done" : ""}" data-act="todo" data-e="${esc(l.entity)}" data-uid="${esc(i.uid)}">
      <span class="chk">${i.status === "completed" ? "✓" : ""}</span><span class="tt">${esc(i.summary)}${i.due ? `<small>${esc(this._fmtDue(i.due))}</small>` : ""}</span></button>`;
    return `${compact ? `<h2 class="link" data-act="view" data-v="lists">${esc(name)} ›</h2>` : `<h2>${esc(name)} <span class="cnt">${open.length}</span></h2>`}
      <input class="add" data-add="${esc(l.entity)}" data-keep="add-${esc(l.entity)}" placeholder="Add to ${esc(name)}…" enterkeyhint="done">
      <div class="todos">${(limit ? open.slice(0, limit) : open).map(row).join("") || `<div class="empty small">All clear ✨</div>`}
      ${limit && open.length > limit ? `<button class="showdone" data-act="view" data-v="lists">+ ${open.length - limit} more ›</button>` : ""}
      ${!compact && done.length ? `<button class="showdone" data-act="showdone" data-e="${esc(l.entity)}">${this._showDone.has(l.entity) ? "Hide" : "Show"} completed (${done.length})</button>${this._showDone.has(l.entity) ? done.map(row).join("") : ""}` : ""}</div>`;
  }
  _fmtDue(due) {
    const d = due.length === 10 ? parseLocalDate(due) : new Date(due);
    const t = startOfDay(new Date());
    const diff = Math.round((startOfDay(d) - t) / DAY_MS);
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff < 0) return `Overdue · ${d.toLocaleDateString([], { month: "short", day: "numeric" })}`;
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  }

  _view_lists() {
    if (!this._lists.length) return `<div class="empty">Add <code>lists:</code> to the card config.</div>`;
    return `<div class="lists">${this._lists.map((l) => `<div class="card">${this._listPanel(l, false)}</div>`).join("")}</div>`;
  }

  /* ---------- modal ---------- */
  _renderModal() {
    const host = this.shadowRoot.querySelector(".modal-host");
    const m = this._modal;
    if (!m) { host.innerHTML = ""; return; }
    if (host.dataset.sig === m.sig && !m.live) return; // don't clobber inputs
    host.dataset.sig = m.sig;
    let inner = "";
    if (m.type === "event") {
      const e = m.ev;
      const when = e.allDay ? `${e.start.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} · All day`
        : `${e.start.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} · ${this._fmtTime(e.start)} – ${this._fmtTime(e.end)}`;
      inner = `<div class="m-bar" style="--c:${e.color}"></div><h2>${esc(e.title)}</h2><p class="m-when">${when}</p>
        ${e.owner ? `<p><span class="a-who" style="--c:${e.color}">${esc(e.owner.name)}</span></p>` : ""}
        ${e.location ? `<p>📍 ${esc(e.location)}</p>` : ""}${e.description ? `<p class="m-desc">${esc(e.description)}</p>` : ""}`;
    } else if (m.type === "day") {
      const d = parseLocalDate(m.date);
      const evs = this._onDay(this._visible(this._eventsFor(...this._range())), d);
      inner = `<h2>${d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</h2>
        ${evs.map((ev) => this._evPill(ev)).join("") || `<div class="empty small">Nothing planned</div>`}
        <button class="btn primary" data-act="add-event" data-date="${m.date}">＋ Add event</button>`;
    } else if (m.type === "add") {
      const who = [...this._people, ...this._shared].filter((o) => !o.read_only);
      inner = `<h2>New event</h2>
        <input class="in" name="title" placeholder="What's happening?" data-keep="m-title">
        <div class="who">${who.map((o) => `<label class="whochip" style="--c:${o.color}"><input type="radio" name="who" value="${esc(o.key)}" ${o.key === m.who ? "checked" : ""}><span>${esc(o.name)}</span></label>`).join("")}</div>
        <div class="row"><input class="in" type="date" name="date" value="${m.date}"><label class="cb"><input type="checkbox" name="allDay"> All day</label></div>
        <div class="row times"><input class="in" type="time" name="start" value="${m.start}"><span>to</span><input class="in" type="time" name="end" value="${m.end}"></div>
        <input class="in" name="location" placeholder="Location (optional)">
        <div class="row end"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="save-event">Save</button></div>`;
    } else if (m.type === "rewards") {
      const rw = this._rewards();
      const p = m.person && this._people.find((x) => x.name === m.person);
      const bal = p && p.stars && this._hass.states[p.stars] ? Number(this._hass.states[p.stars].state) || 0 : 0;
      const canEdit = !!this._config.rewards_list;
      if (m.edit) {
        inner = `<h2>Rewards</h2><p class="m-when">What stars can be traded in for. Tap one to change it.</p>
          <div class="rw-list">${rw.map((r) => `<button class="rw-row" data-act="reward-open" data-uid="${esc(r.uid)}"><span class="ri">${esc(r.icon)}</span><span class="rn">${esc(r.name)}</span><span class="rc">${r.cost} ⭐</span><span class="pen">✏️</span></button>`).join("") || `<div class="empty small">No rewards yet</div>`}</div>
          <div class="row end"><button class="btn" data-act="close">Done</button><button class="btn primary" data-act="reward-new">＋ New reward</button></div>`;
      } else {
        const waiting = (this._owed() || []).filter((o) => !o.done && p && o.person === p);
        inner = `<h2>${esc(p ? p.name + "'s rewards" : "Rewards")}</h2>${p ? `<p class="m-when">⭐ ${bal} stars saved</p>` : ""}
          ${waiting.length ? `<p class="waiting">Waiting on: ${waiting.map((o) => `${esc(o.icon)} ${esc(o.name)}`).join(", ")}</p>` : ""}
          <div class="rewards">${rw.map((r, i) => `<button class="reward ${bal < r.cost ? "locked" : ""}" data-act="redeem" data-p="${esc(m.person || "")}" data-i="${i}">
            <span class="ri">${esc(r.icon || "🎁")}</span><span class="rn">${esc(r.name)}</span><span class="rc">${r.cost} ⭐</span></button>`).join("") || `<div class="empty small">No rewards set up yet</div>`}</div>
          <div class="row end">${canEdit ? `<button class="btn" data-act="rewards-edit">✏️ Edit rewards</button>` : ""}<button class="btn primary" data-act="close">Done</button></div>`;
      }
    } else if (m.type === "reward-form") {
      inner = `<h2>${m.uid ? "Edit reward" : "New reward"}</h2>
        <div class="row"><input class="in emoji" name="emoji" value="${esc(m.emoji || "")}" placeholder="🎁"><input class="in" name="name" value="${esc(m.name || "")}" placeholder="Reward name, like Pizza night"></div>
        <div class="emojis">${REWARD_EMOJI.map((e) => `<button data-act="emoji-pick" data-e="${e}">${e}</button>`).join("")}</div>
        <div class="lbl">Costs</div>
        <div class="row"><button class="btn step" data-act="step" data-d="-1">−</button><input class="in cost" type="number" min="1" name="cost" value="${m.cost || 5}"><span class="star-lbl">⭐ stars</span><button class="btn step" data-act="step" data-d="1">＋</button></div>
        <div class="row end">${m.uid ? `<button class="btn danger" data-act="reward-del">Delete</button><span class="grow"></span>` : ""}<button class="btn" data-act="rewards-back">Cancel</button><button class="btn primary" data-act="reward-save">Save</button></div>`;
    } else if (m.type === "chore-form") {
      const kids = this._people.filter((x) => x.chores);
      inner = `<h2>${m.uid ? "Edit chore" : "New chore"}</h2>
        <div class="row"><input class="in emoji" name="emoji" value="${esc(m.emoji || "")}" placeholder="🙂"><input class="in" name="name" value="${esc(m.name || "")}" placeholder="Chore name, like Feed the dog"></div>
        <div class="emojis">${CHORE_EMOJI.map((e) => `<button data-act="emoji-pick" data-e="${e}">${e}</button>`).join("")}</div>
        <div class="lbl">For</div>
        <div class="who">${m.uid ? `<span class="whochip" style="--c:${(kids.find((k) => k.name === m.person) || {}).color}"><span class="sel">${esc(m.person)}</span></span>`
          : kids.map((k) => `<label class="whochip" style="--c:${k.color}"><input type="checkbox" name="kid" value="${esc(k.name)}" ${m.kids.includes(k.name) ? "checked" : ""}><span>${esc(k.name)}</span></label>`).join("")}</div>
        <div class="lbl">When</div>
        <div class="who">${PERIODS.map((per) => `<label class="whochip" style="--c:var(--accent)"><input type="radio" name="period" value="${per.id}" ${m.period === per.id ? "checked" : ""}><span>${per.icon} ${per.label}</span></label>`).join("")}</div>
        <div class="lbl">Stars earned</div>
        <div class="who">${[0, 1, 2, 3, 4, 5].map((n) => `<label class="whochip" style="--c:#d9a400"><input type="radio" name="stars" value="${n}" ${Number(m.stars) === n ? "checked" : ""}><span>${n ? n + " ⭐" : "None"}</span></label>`).join("")}</div>
        <div class="row end">${m.uid ? `<button class="btn danger" data-act="chore-del">Delete</button><span class="grow"></span>` : ""}<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="chore-save">Save</button></div>`;
    } else if (m.type === "pin") {
      inner = `<h2>Parent PIN</h2><div class="pin-dots">${"•".repeat(m.entered.length) || "&nbsp;"}</div>
        <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "⌫"].map((d) => d === "" ? "<span></span>" : `<button data-act="pin" data-d="${d}">${d}</button>`).join("")}</div>
        <div class="row end"><button class="btn" data-act="close">Cancel</button></div>`;
    } else if (m.type === "confirm") {
      inner = `<h2>${esc(m.text)}</h2><div class="row end"><button class="btn" data-act="close">No</button><button class="btn primary" data-act="confirm-yes">Yes</button></div>`;
    }
    host.innerHTML = `<div class="scrim" data-act="close-scrim"><div class="modal" role="dialog">${inner}</div></div>`;
  }

  _openModal(m) { m.sig = Math.random().toString(36); this._modal = m; this._renderModal(); }
  _closeModal() { this._modal = null; this._renderModal(); }

  /* ---------- events ---------- */
  _onClick(ev) {
    this._lastTouch = Date.now();
    const el = ev.composedPath().find((n) => n.dataset && n.dataset.act);
    if (!el) return;
    const a = el.dataset.act;
    const all = () => this._eventsFor(...this._range()) || [];
    switch (a) {
      case "view": this._view = el.dataset.v; this._anchor = startOfDay(new Date()); this._scrollNow = this._view === "planner"; this._render(); break;
      case "filter": {
        const k = el.dataset.k;
        this._hidden.has(k) ? this._hidden.delete(k) : this._hidden.add(k);
        this._save("hidden", [...this._hidden]); this._render(); break;
      }
      case "prev": case "next": {
        const dir = a === "next" ? 1 : -1;
        this._anchor = this._view === "month" ? new Date(this._anchor.getFullYear(), this._anchor.getMonth() + dir, 1) : addDays(this._anchor, (this._view === "planner" ? 1 : 7) * dir);
        this._render(); break;
      }
      case "today": this._anchor = startOfDay(new Date()); this._scrollNow = this._view === "planner"; this._render(); break;
      case "theme": {
        const i = THEMES.findIndex((t) => t.id === this._themeMode());
        const next = THEMES[(i + 1) % THEMES.length];
        this._save("theme", next.id); this._render(); this._toast(`${next.icon} ${next.label} mode${next.id === "sun" ? ": dark after sunset" : next.id === "auto" ? ": follows Home Assistant" : ""}`);
        break;
      }
      case "slot": {
        const h = Number(el.dataset.h);
        this._openModal({ type: "add", date: ymd(this._anchor), start: `${pad(h)}:00`, end: `${pad(Math.min(23, h + 1))}:${h + 1 > 23 ? "59" : "00"}`, who: el.dataset.who || (this._shared[0] || this._people[0]).key });
        break;
      }
      case "event": {
        const e = all().find((x) => this._evId(x) === el.dataset.id);
        if (e) this._openModal({ type: "event", ev: e });
        break;
      }
      case "day": this._openModal({ type: "day", date: el.dataset.date }); break;
      case "add-event": {
        const now = new Date();
        const h = Math.min(22, now.getHours() + 1);
        const first = this._people[0];
        this._openModal({ type: "add", date: el.dataset.date || ymd(now), start: `${pad(h)}:00`, end: `${pad(h + 1)}:00`, who: (this._shared[0] || first).key });
        break;
      }
      case "save-event": {
        const mod = this.shadowRoot.querySelector(".modal");
        const q = (n) => mod.querySelector(`[name="${n}"]`);
        const who = mod.querySelector('[name="who"]:checked');
        const f = { title: q("title").value, who: who ? who.value : "", date: q("date").value, allDay: q("allDay").checked, start: q("start").value, end: q("end").value, location: q("location").value };
        if (!f.allDay && f.end <= f.start) { this._toast("End time must be after start"); break; }
        el.disabled = true;
        this._createEvent(f).then((ok) => { if (ok) { this._closeModal(); this._toast("Event added ✓"); } else el.disabled = false; }).catch(() => (el.disabled = false));
        break;
      }
      case "close": this._closeModal(); break;
      case "close-scrim": if (ev.target === el) this._closeModal(); break;
      case "chore": {
        const p = this._people.find((x) => x.name === el.dataset.p);
        if (p) this._toggleChore(p, el.dataset.uid).catch(() => {});
        break;
      }
      case "todo": this._toggleTodo(el.dataset.e, el.dataset.uid).catch(() => {}); break;
      case "showdone": { const k = el.dataset.e; this._showDone.has(k) ? this._showDone.delete(k) : this._showDone.add(k); this._render(); break; }
      case "rewards": this._openModal({ type: "rewards", person: el.dataset.p }); break;
      case "redeem": {
        const p = this._people.find((x) => x.name === el.dataset.p);
        if (!p || !p.stars) { this._toast("Open rewards from a kid's star badge to spend stars"); break; }
        const r = this._rewards()[Number(el.dataset.i)];
        if (!r) break;
        const bal = Number(this._hass.states[p.stars].state) || 0;
        if (bal < r.cost) { this._toast(`Need ${r.cost - bal} more ⭐`); break; }
        this._openModal({ type: "confirm", text: `Spend ${r.cost} ⭐ on “${r.name}” for ${p.name}?`, onYes: async () => {
          await this._svc("counter", "set_value", { value: bal - r.cost }, { entity_id: p.stars });
          const owedList = this._config.rewards_owed_list;
          if (owedList) await this._svc("todo", "add_item", { item: `${r.icon || "🎁"} ${r.name}`,
            description: `${p.name} · ${r.cost}⭐ · redeemed ${new Date().toLocaleDateString([], { month: "short", day: "numeric" })}` }, { entity_id: owedList });
          this._celebrate(`${r.icon || "🎁"} ${r.name}!${owedList ? " Added to the owed list" : ""}`, true);
        } });
        break;
      }
      case "owed-give": case "owed-undo": {
        const uid = el.dataset.uid, status = a === "owed-give" ? "completed" : "needs_action";
        this._gate(() => this._svc("todo", "update_item", { item: uid, status }, { entity_id: this._config.rewards_owed_list })
          .then(() => this._toast(status === "completed" ? "Marked as given ✓" : "Back on the owed list")).catch(() => {}));
        break;
      }
      case "owed-refund": {
        const o = (this._owed() || []).find((x) => x.uid === el.dataset.uid);
        if (!o) break;
        this._gate(() => this._openModal({ type: "confirm", text: o.person && o.person.stars && o.cost ? `Cancel “${o.name}” and give ${o.cost} ⭐ back to ${o.person.name}?` : `Remove “${o.name}” from the owed list?`, onYes: async () => {
          if (o.person && o.person.stars && o.cost && this._hass.states[o.person.stars]) {
            const cur = Number(this._hass.states[o.person.stars].state) || 0;
            await this._svc("counter", "set_value", { value: cur + o.cost }, { entity_id: o.person.stars });
          }
          await this._svc("todo", "remove_item", { item: o.uid }, { entity_id: this._config.rewards_owed_list });
          this._toast(o.cost ? `Refunded ${o.cost} ⭐` : "Removed");
        } }));
        break;
      }
      case "chore-edit": this._gate(() => { this._editChores = !this._editChores; this._render(); }); break;
      case "chore-add": {
        const kids = this._people.filter((x) => x.chores).map((x) => x.name);
        const preset = el.dataset.p ? [el.dataset.p] : kids;
        this._gate(() => this._openModal({ type: "chore-form", kids: preset, period: "anytime", stars: 1, emoji: "", name: "" }));
        break;
      }
      case "chore-open": {
        const p = this._people.find((x) => x.name === el.dataset.p);
        const raw = p && (this._todos[p.chores] || []).find((i) => i.uid === el.dataset.uid);
        if (!raw) break;
        const c = this._parseChore(raw);
        const [emoji, name] = splitEmoji(raw.summary);
        this._openModal({ type: "chore-form", uid: raw.uid, person: p.name, emoji, name, period: c.period, stars: c.stars, kids: [p.name] });
        break;
      }
      case "chore-save": {
        const mod = this.shadowRoot.querySelector(".modal");
        const val = (n) => { const x = mod.querySelector(`[name="${n}"]:checked`) || mod.querySelector(`[name="${n}"]`); return x ? x.value : ""; };
        const f = { uid: this._modal.uid, person: this._modal.person, emoji: val("emoji"), name: val("name"), period: val("period") || "anytime",
          stars: Number(val("stars")) || 0, kids: [...mod.querySelectorAll('[name="kid"]:checked')].map((x) => x.value) };
        el.disabled = true;
        this._saveChore(f).then((ok) => { if (ok) { this._closeModal(); this._toast(f.uid ? "Chore updated ✓" : "Chore added ✓"); } else el.disabled = false; }).catch(() => (el.disabled = false));
        break;
      }
      case "chore-del": {
        const m = this._modal;
        const p = this._people.find((x) => x.name === m.person);
        this._openModal({ type: "confirm", text: `Delete “${m.name}” from ${m.person}'s chores?`, onYes: async () => {
          await this._svc("todo", "remove_item", { item: m.uid }, { entity_id: p.chores });
          this._toast("Chore deleted");
        } });
        break;
      }
      case "emoji-pick": { const i = this.shadowRoot.querySelector('.modal [name="emoji"]'); if (i) i.value = el.dataset.e; break; }
      case "step": { const i = this.shadowRoot.querySelector('.modal [name="cost"]'); if (i) i.value = Math.max(1, (Number(i.value) || 0) + Number(el.dataset.d)); break; }
      case "rewards-edit": this._gate(() => this._openModal({ type: "rewards", edit: true, live: true })); break;
      case "rewards-back": this._openModal({ type: "rewards", edit: true, live: true }); break;
      case "reward-new": this._openModal({ type: "reward-form", emoji: "", name: "", cost: 5 }); break;
      case "reward-open": {
        const r = this._rewards().find((x) => x.uid === el.dataset.uid);
        if (r) this._openModal({ type: "reward-form", uid: r.uid, emoji: r.icon, name: r.name, cost: r.cost });
        break;
      }
      case "reward-save": {
        const mod = this.shadowRoot.querySelector(".modal");
        const q = (n) => mod.querySelector(`[name="${n}"]`).value;
        const f = { uid: this._modal.uid, emoji: q("emoji"), name: q("name"), cost: q("cost") };
        el.disabled = true;
        this._saveReward(f).then((ok) => { if (ok) { this._openModal({ type: "rewards", edit: true, live: true }); this._toast("Reward saved ✓"); } else el.disabled = false; }).catch(() => (el.disabled = false));
        break;
      }
      case "reward-del": {
        const m = this._modal;
        this._openModal({ type: "confirm", text: `Delete the “${m.name}” reward?`, onYes: async () => {
          await this._svc("todo", "remove_item", { item: m.uid }, { entity_id: this._config.rewards_list });
          this._openModal({ type: "rewards", edit: true, live: true });
        } });
        break;
      }
      case "pin": {
        const m = this._modal;
        if (el.dataset.d === "⌫") m.entered = m.entered.slice(0, -1); else m.entered += el.dataset.d;
        const pin = String(this._config.parent_pin);
        const dots = this.shadowRoot.querySelector(".pin-dots");
        if (m.entered.length >= pin.length) {
          if (m.entered === pin) { this._unlockedUntil = Date.now() + 5 * 60000; this._closeModal(); m.then(); break; }
          m.entered = ""; this._toast("Wrong PIN");
        }
        if (dots) dots.innerHTML = "•".repeat(m.entered.length) || "&nbsp;";
        break;
      }
      case "confirm-yes": { const m = this._modal; this._closeModal(); if (m && m.onYes) m.onYes().catch(() => {}); break; }
    }
  }

  _toast(msg) {
    const t = this.shadowRoot.querySelector(".toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(this._toastT); this._toastT = setTimeout(() => t.classList.remove("show"), 2600);
  }
  _celebrate(msg, big) {
    this._toast(msg);
    if (!big) return;
    const host = this.shadowRoot.querySelector(".confetti");
    const bits = ["🎉", "⭐", "✨", "🎊", "🌟"];
    host.innerHTML = [...Array(36)].map((_, i) => `<span style="left:${Math.random() * 100}%;animation-delay:${Math.random() * 0.6}s;font-size:${18 + Math.random() * 22}px">${bits[i % bits.length]}</span>`).join("");
    clearTimeout(this._confT); this._confT = setTimeout(() => (host.innerHTML = ""), 3200);
  }

  // Pre-fills a new card from the people, calendars and weather already in Home Assistant
  static getStubConfig(hass) {
    const ids = hass ? Object.keys(hass.states) : [];
    const cals = ids.filter((e) => e.startsWith("calendar."));
    const used = new Set();
    const people = ids.filter((e) => e.startsWith("person.")).slice(0, 6).map((pid, i) => {
      const raw = (hass.states[pid].attributes.friendly_name || pid.split(".")[1]).split(/[ _]/)[0];
      const name = raw.charAt(0).toUpperCase() + raw.slice(1);
      const first = name.toLowerCase();
      const mine = cals.filter((c) => c.split(".")[1].startsWith(first));
      mine.forEach((c) => used.add(c));
      return { name, color: ED_PALETTE[i % ED_PALETTE.length], person: pid, calendars: mine };
    });
    const family = cals.find((c) => !used.has(c) && /family|home|house/.test(c));
    const weather = ids.find((e) => e.startsWith("weather."));
    const lists = ids.filter((e) => e.startsWith("todo.") && /shopping|home|grocer/.test(e)).slice(0, 2);
    return {
      ...(weather ? { weather_entity: weather } : {}),
      people: people.length ? people : [{ name: "Me", color: ED_PALETTE[0], calendars: cals.slice(0, 1) }],
      ...(family ? { shared: [{ name: "Family", color: ED_PALETTE[4], calendars: [family] }] } : {}),
      ...(lists.length ? { lists } : {}),
    };
  }
}

const SKYFAM_CSS = `
:host([preview]) .app { height:640px; }
:host { display:block; height:100%; --bg:#f6f3ee; --card:#fff; --ink:#2e2a26; --mute:#8b8378; --line:#ece6dc; --accent:#3d6b8a; --r:22px;
  font-family: "Nunito","Quicksand","Segoe UI Rounded","SF Pro Rounded",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
* { box-sizing:border-box; }
button { font:inherit; color:inherit; background:none; border:0; cursor:pointer; text-align:left; -webkit-tap-highlight-color:transparent; }
.modal-host { display:contents; }
.app { position:relative; display:grid; grid-template-columns: 92px 1fr; grid-template-rows: minmax(0,1fr); height: calc(100dvh - var(--skyfam-offset, 56px)); background:var(--bg); color:var(--ink); overflow:hidden; }
.app.dark { --bg:#141413; --card:#232120; --ink:#f3eee6; --mute:#a59c90; --line:#363230; --accent:#7fb2d6; color-scheme:dark; }
.app.dark .card, .app.dark .wx, .app.dark .nb, .app.dark .planner { box-shadow:none; }
.app.dark .pill.allday, .app.dark .av, .app.dark .whochip input:checked + span, .app.dark .btn.primary, .app.dark .fab, .app.dark .tab.on, .app.dark .dh.today .dd { color:#141413; }
.app.dark .btn.danger { background:#4a2422; color:#ffb4ab; }
.app.dark .stars, .app.dark .bank, .app.dark .cs, .app.dark .rc, .app.dark .star-lbl { color:#f2c14e; }
.app.dark .chore.done .chk, .app.dark .todo.done .chk { color:#141413; }
.rail { display:flex; flex-direction:column; gap:6px; padding:18px 10px; background:var(--card); border-right:1px solid var(--line); }
.nav { display:flex; flex-direction:column; align-items:center; gap:4px; padding:12px 4px; border-radius:18px; color:var(--mute); font-size:12px; font-weight:700; }
.nav ha-icon { --mdc-icon-size:28px; } .nav .emo { font-size:24px; }
.nav.on { background:color-mix(in srgb, var(--accent) 14%, transparent); color:var(--accent); }
.main { display:flex; flex-direction:column; min-width:0; min-height:0; }
.top { display:flex; align-items:center; gap:22px; padding:16px 26px 10px; flex-wrap:wrap; }
.when { display:flex; flex-direction:column; }
.clock { font-size:44px; font-weight:800; letter-spacing:-1px; line-height:1; } .clock small { font-size:18px; font-weight:700; margin-left:4px; color:var(--mute); }
.date { font-size:17px; color:var(--mute); font-weight:700; margin-top:2px; }
.title { font-size:22px; font-weight:800; }
.wx { display:flex; align-items:center; gap:8px; background:var(--card); border-radius:18px; padding:8px 14px; box-shadow:0 1px 3px rgba(0,0,0,.05); }
.wx-i { font-size:28px; } .wx-t { font-size:26px; font-weight:800; } .wx-hl { color:var(--mute); font-weight:700; font-size:14px; }
.chips { display:flex; gap:8px; flex-wrap:wrap; margin-left:auto; }
.chip { display:flex; align-items:center; gap:8px; padding:6px 14px 6px 6px; border-radius:999px; background:color-mix(in srgb, var(--c) 22%, var(--card)); font-weight:800; font-size:15px; transition:opacity .2s; }
.chip.off { opacity:.35; filter:grayscale(.7); }
.av { position:relative; width:32px; height:32px; border-radius:50%; background:var(--c); color:#fff; display:grid; place-items:center; font-weight:900; font-size:15px; }
.dot { position:absolute; right:-2px; bottom:-2px; width:12px; height:12px; border-radius:50%; border:2px solid var(--card); }
.av.pic { background-color:var(--c); background-size:cover; background-position:center; box-shadow:0 0 0 2px var(--c); }
.dot.home { background:#3cb371; } .dot.away { background:#c9c2b8; }
.body { flex:1; min-height:0; overflow:auto; padding:6px 22px 96px; }
.card { background:var(--card); border-radius:var(--r); padding:18px; box-shadow:0 1px 4px rgba(60,40,10,.06); }
h2 { font-size:22px; margin:0 0 12px; font-weight:900; } h3 { font-size:14px; text-transform:uppercase; letter-spacing:.08em; color:var(--mute); margin:16px 0 8px; } h3:first-of-type { margin-top:0; }
h4 { margin:14px 0 8px; font-size:15px; color:var(--mute); font-weight:800; }
.link { cursor:pointer; }
.empty { color:var(--mute); padding:30px; text-align:center; font-weight:700; } .empty.small { padding:10px 4px; text-align:left; font-size:15px; }

/* today */
.v-today { display:grid; grid-template-columns: 1.35fr 1fr 1fr; gap:18px; align-items:start; }
.col { min-width:0; }
.agenda { display:grid; grid-template-columns:74px 6px 1fr auto; align-items:center; gap:12px; width:100%; padding:10px 8px; border-radius:16px; }
.agenda:hover { background:color-mix(in srgb, var(--c) 8%, transparent); }
.agenda.past { opacity:.45; } .agenda.now { background:color-mix(in srgb, var(--c) 14%, transparent); }
.a-time { font-weight:800; font-size:15px; display:flex; flex-direction:column; } .a-time small { color:var(--mute); font-weight:700; }
.a-bar { width:6px; align-self:stretch; border-radius:6px; background:var(--c); }
.a-main { display:flex; flex-direction:column; min-width:0; } .a-title { font-weight:800; font-size:17px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.a-loc { color:var(--mute); font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.a-who { background:color-mix(in srgb, var(--c) 25%, var(--card)); padding:4px 10px; border-radius:999px; font-size:13px; font-weight:800; }
.kid-mini { padding:12px; border-radius:18px; background:color-mix(in srgb, var(--c) 10%, var(--card)); margin-bottom:12px; }
.km-head { display:flex; align-items:center; gap:12px; margin-bottom:6px; } .km-head b { font-size:18px; display:block; } .km-head span { color:var(--mute); font-weight:700; font-size:14px; }
.ringw { position:relative; display:block; width:54px; height:54px; flex:none; } .ring { width:100%; height:100%; display:block; }
.ringw img { position:absolute; left:18%; top:18%; width:64%; height:64%; border-radius:50%; object-fit:cover; } .ring-bg { fill:none; stroke:color-mix(in srgb, var(--ink) 8%, transparent); stroke-width:6; }
.ring-fg { fill:none; stroke-width:6; stroke-linecap:round; transform:rotate(-90deg); transform-origin:center; transition:stroke-dashoffset .5s; } .ring text { font-weight:900; font-size:17px; fill:var(--ink); }
.stars { color:#b88400; font-weight:900; }
.chore-row { display:flex; align-items:center; gap:10px; width:100%; padding:9px 6px; font-weight:700; font-size:16px; border-radius:12px; }
.chk { width:28px; height:28px; border-radius:50%; border:3px solid color-mix(in srgb, var(--c, var(--accent)) 60%, transparent); flex:none; display:grid; place-items:center; font-weight:900; color:#fff; }

/* week */
.navbar { display:flex; align-items:center; gap:8px; margin:4px 0 14px; } .navbar h2 { margin:0 0 0 10px; }
.nb { background:var(--card); border-radius:14px; padding:8px 16px; font-size:22px; font-weight:900; box-shadow:0 1px 3px rgba(0,0,0,.05); } .today-btn { font-size:16px; }
.v-week { display:flex; flex-direction:column; padding-bottom:16px; }
.week { flex:1; min-height:0; display:grid; grid-template-columns:repeat(7, minmax(0,1fr)); gap:10px; }
.wcol { background:var(--card); border-radius:20px; padding:10px; display:flex; flex-direction:column; gap:6px; min-height:0; overflow:auto; }
.wcol.today { box-shadow: inset 0 0 0 3px var(--accent); } .wcol.pastday { opacity:.7; }
.dh { display:flex; align-items:baseline; gap:6px; padding:2px 4px 6px; border-bottom:1px solid var(--line); flex-wrap:wrap; }
.dn { font-weight:800; color:var(--mute); text-transform:uppercase; font-size:13px; } .dd { font-size:24px; font-weight:900; }
.dh.today .dd { background:var(--accent); color:#fff; border-radius:12px; padding:0 8px; }
.df { margin-left:auto; font-size:13px; font-weight:800; color:var(--mute); }
.wlist { display:flex; flex-direction:column; gap:6px; flex:1; }
.pill { display:block; width:100%; padding:7px 9px; border-radius:12px; background:color-mix(in srgb, var(--c) 22%, var(--card)); border-left:5px solid var(--c); font-size:14px; font-weight:700; line-height:1.25; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; }
.pill.allday { background:var(--c); color:#fff; border-left:0; } .pill.past { opacity:.5; }
.wadd { color:var(--mute); font-size:22px; text-align:center; border-radius:12px; padding:4px; } .wadd:hover { background:var(--line); }

/* month */
.v-month { display:flex; flex-direction:column; padding-bottom:16px; }
.month { flex:1; min-height:0; display:grid; grid-template-columns:repeat(7, minmax(0,1fr)); grid-template-rows:auto repeat(6, minmax(78px, 1fr)); gap:6px; }
.mh { text-align:center; font-weight:800; color:var(--mute); text-transform:uppercase; font-size:13px; padding:4px; }
.mc { background:var(--card); border-radius:14px; min-height:0; padding:6px; display:flex; flex-direction:column; gap:3px; cursor:pointer; overflow:hidden; }
.mc.out { opacity:.45; } .mc.today { box-shadow: inset 0 0 0 3px var(--accent); }
.mcd { font-weight:900; font-size:15px; }
.mp { flex:none; font-size:12px; font-weight:700; padding:2px 6px; border-radius:7px; background:color-mix(in srgb, var(--c) 25%, var(--card)); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.more { flex:none; font-size:12px; color:var(--mute); font-weight:800; }

/* chores */
.chores { display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:18px; }
.kid { background:color-mix(in srgb, var(--c) 9%, var(--card)); }
.kid-head { display:flex; align-items:center; gap:14px; } .kh-txt { flex:1; } .kh-txt b { font-size:24px; display:block; } .kh-txt span { color:var(--mute); font-weight:700; }
.kid-head .ringw { width:68px; height:68px; }
.bank { display:flex; flex-direction:column; align-items:center; background:var(--card); border-radius:18px; padding:8px 14px; font-size:22px; font-weight:900; color:#b88400; } .bank small { font-size:12px; color:var(--mute); }
.chore { display:flex; align-items:center; gap:14px; width:100%; background:var(--card); border-radius:18px; padding:14px; margin-bottom:8px; font-size:19px; font-weight:800; transition:transform .1s; }
.chore:active { transform:scale(.98); }
.chore .chk { width:38px; height:38px; font-size:20px; }
.chore.done .chk, .todo.done .chk { background:var(--c, var(--accent)); border-color:var(--c, var(--accent)); }
.chore.done .ct { text-decoration:line-through; color:var(--mute); }
.ct { flex:1; } .cs { font-size:15px; color:#b88400; }

/* lists */
.lists { display:grid; grid-template-columns:repeat(auto-fit, minmax(340px, 1fr)); gap:18px; align-items:start; }
.tabs { display:flex; gap:8px; margin:4px 0 14px; flex-wrap:wrap; }
.tab { background:var(--card); padding:10px 18px; border-radius:999px; font-weight:800; font-size:16px; display:flex; gap:8px; align-items:center; }
.tab span { background:var(--line); border-radius:999px; padding:0 8px; font-size:13px; } .tab.on { background:var(--accent); color:#fff; } .tab.on span { background:rgba(255,255,255,.25); }
.add { width:100%; border:2px solid var(--line); background:var(--bg); border-radius:16px; padding:12px 14px; font:inherit; font-size:16px; font-weight:700; color:var(--ink); margin-bottom:8px; outline:none; }
.add:focus { border-color:var(--accent); }
.todo { display:flex; align-items:center; gap:12px; width:100%; padding:10px 4px; border-bottom:1px solid var(--line); font-weight:700; font-size:16px; }
.todo .chk { --c:var(--accent); width:26px; height:26px; }
.tt { display:flex; flex-direction:column; } .tt small { color:var(--mute); font-size:13px; }
.todo.done .tt { text-decoration:line-through; color:var(--mute); }
.showdone { color:var(--accent); font-weight:800; padding:12px 4px; }
.cnt { background:var(--line); border-radius:999px; padding:0 10px; font-size:15px; vertical-align:middle; }
.v-today .todos { max-height:60vh; overflow:auto; }
.lists-col { display:flex; flex-direction:column; gap:18px; }
.v-today .stacked .todos { max-height:none; overflow:visible; }
.stacked h2 { font-size:19px; margin-bottom:8px; } .stacked .add { padding:9px 12px; font-size:15px; } .stacked .todo { padding:8px 4px; }

/* modal, fab, toast */
.fab { position:absolute; right:28px; bottom:28px; width:66px; height:66px; border-radius:50%; background:var(--accent); color:#fff; font-size:34px; font-weight:400; text-align:center; box-shadow:0 6px 18px rgba(0,0,0,.2); z-index:3; }
.scrim { position:absolute; inset:0; background:rgba(30,25,20,.35); display:grid; place-items:center; z-index:10; padding:16px; }
.modal { position:relative; background:var(--card); border-radius:26px; padding:24px; width:min(520px, 100%); max-height:90%; overflow:auto; box-shadow:0 20px 60px rgba(0,0,0,.25); display:flex; flex-direction:column; gap:12px; }
.modal h2 { margin:0; } .modal p { margin:0; font-weight:600; } .m-when { color:var(--mute); font-weight:800 !important; }
.m-bar { height:8px; border-radius:8px; background:var(--c); } .m-desc { white-space:pre-wrap; color:var(--mute); }
.in { border:2px solid var(--line); background:var(--bg); border-radius:14px; padding:12px; font:inherit; font-size:16px; font-weight:700; color:var(--ink); width:100%; }
.row { display:flex; gap:10px; align-items:center; } .row.end { justify-content:flex-end; } .times span { font-weight:800; color:var(--mute); }
.cb { display:flex; gap:6px; align-items:center; font-weight:800; white-space:nowrap; }
.who { display:flex; flex-wrap:wrap; gap:8px; }
.whochip input { display:none; } .whochip span { display:block; padding:8px 14px; border-radius:999px; border:2px solid var(--c); font-weight:800; cursor:pointer; }
.whochip input:checked + span { background:var(--c); color:#fff; }
.btn { padding:12px 20px; border-radius:14px; background:var(--line); font-weight:800; } .btn.primary { background:var(--accent); color:#fff; }
.btn:disabled { opacity:.5; }
.modal:has(input[name="allDay"]:checked) .times { display:none; }
.rewards { display:grid; grid-template-columns:repeat(auto-fill, minmax(140px,1fr)); gap:10px; }
.reward { display:flex; flex-direction:column; align-items:center; gap:4px; background:var(--bg); border-radius:18px; padding:14px; font-weight:800; text-align:center; }
.reward .ri { font-size:34px; } .reward .rc { color:#b88400; } .reward.locked { opacity:.45; }
.toast { position:absolute; left:50%; bottom:28px; transform:translate(-50%, 40px); background:var(--ink); color:var(--card); padding:12px 22px; border-radius:999px; font-weight:800; opacity:0; transition:.25s; pointer-events:none; z-index:20; }
.toast.show { opacity:1; transform:translate(-50%, 0); }
.confetti { position:absolute; inset:0; pointer-events:none; overflow:hidden; z-index:15; }
.confetti span { position:absolute; top:-40px; animation:fall 2.6s ease-in forwards; }
@keyframes fall { to { transform: translateY(110vh) rotate(540deg); opacity:.8; } }

/* theme button */
.themebtn { display:flex; align-items:center; gap:6px; background:var(--card); border-radius:999px; padding:8px 14px; font-weight:800; font-size:14px; color:var(--mute); box-shadow:0 1px 3px rgba(0,0,0,.05); }
.themebtn { font-size:18px; } .themebtn span { font-size:13px; }

/* planner */
.v-planner { display:flex; flex-direction:column; padding-bottom:16px; }
.planner { flex:1; min-height:0; display:flex; flex-direction:column; background:var(--card); border-radius:22px; overflow:hidden; box-shadow:0 1px 4px rgba(60,40,10,.06); }
.pl-top { position:sticky; top:0; z-index:4; background:var(--card); border-bottom:1px solid var(--line); min-width:fit-content; }
.pl-heads { display:grid; padding:10px 0 6px; }
.pl-allrow { display:grid; }
.pl-head { display:flex; align-items:center; gap:8px; padding:0 10px; font-size:17px; min-width:0; }
.pl-head b { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pl-scroll { flex:1; min-height:0; overflow:auto; }
.pl-body { display:grid; position:relative; min-width:fit-content; padding-top:10px; }
.pl-col { border-left:1px solid var(--line); min-width:0; }
.pl-all { min-height:34px; padding:4px; display:flex; flex-direction:column; gap:4px; border-left:1px solid var(--line); min-width:0; }
.pl-all .pill { -webkit-line-clamp:1; padding:4px 8px; font-size:13px; }
.pl-all-label { font-size:11px; font-weight:800; color:var(--mute); text-transform:uppercase; align-self:center; text-align:center; }
.pl-grid { position:relative; }
.pl-hr { position:absolute; left:0; right:0; border-top:1px solid var(--line); }
.pl-hr span { position:absolute; top:-9px; right:8px; font-size:12px; font-weight:800; color:var(--mute); background:var(--card); padding:0 2px; }
.pl-times .pl-grid { border-right:0; }
.pl-slot { position:absolute; left:0; right:0; border-top:1px solid var(--line); cursor:pointer; }
.pl-slot:hover { background:color-mix(in srgb, var(--c) 7%, transparent); }
.pl-ev { position:absolute; z-index:1; display:flex; flex-direction:column; gap:1px; padding:5px 8px; border-radius:10px; background:color-mix(in srgb, var(--c) 24%, var(--card)); border-left:5px solid var(--c); overflow:hidden; text-align:left; }
.pl-ev b { font-size:14px; line-height:1.2; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pl-ev span { font-size:12px; color:var(--mute); font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pl-ev.short { flex-direction:row; align-items:center; gap:6px; padding:2px 8px; } .pl-ev.past { opacity:.5; }
.pl-now { position:absolute; left:var(--plt, 64px); right:0; height:2px; background:#e0453a; z-index:2; pointer-events:none; margin-top:10px; }
.pl-now::before { content:""; position:absolute; left:-6px; top:-5px; width:12px; height:12px; border-radius:50%; background:#e0453a; }

/* editing */
.chorebar { display:flex; gap:10px; margin:4px 0 14px; flex-wrap:wrap; }
.btn.on { background:var(--accent); color:#fff; } .btn.danger { background:#f8dcd8; color:#a3271b; } .grow { flex:1; }
.chores.editing .chore { box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--c) 45%, transparent); }
.pen { font-size:18px; opacity:.7; }
.addrow { width:100%; text-align:center; padding:14px; border-radius:18px; border:2px dashed color-mix(in srgb, var(--c) 55%, transparent); color:var(--mute); font-weight:800; font-size:16px; margin-top:4px; }
.lbl { font-weight:800; color:var(--mute); font-size:13px; text-transform:uppercase; letter-spacing:.06em; margin-top:4px; }
.in.emoji { width:72px; flex:none; text-align:center; font-size:24px; padding:8px; }
.emojis { display:flex; flex-wrap:wrap; gap:2px; } .emojis button { font-size:24px; padding:4px 6px; border-radius:10px; } .emojis button:hover { background:var(--line); }
.whochip .sel { display:block; padding:8px 14px; border-radius:999px; background:var(--c); color:#fff; font-weight:800; }
.in.cost { width:90px; text-align:center; font-size:20px; } .star-lbl { font-weight:800; color:#b88400; } .btn.step { font-size:22px; padding:8px 18px; }
.rw-list { display:flex; flex-direction:column; gap:8px; }
.rw-row { display:flex; align-items:center; gap:12px; padding:12px 14px; background:var(--bg); border-radius:16px; font-weight:800; font-size:17px; }
.rw-row .ri { font-size:28px; } .rw-row .rn { flex:1; } .rw-row .rc { color:#b88400; }
.pin-dots { font-size:40px; letter-spacing:12px; text-align:center; min-height:52px; }
.pad { display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; } .pad button { background:var(--bg); border-radius:16px; padding:16px; font-size:26px; font-weight:900; text-align:center; }

/* owed rewards */
.owed { background:color-mix(in srgb, #d9a400 9%, var(--card)); }
.owed-list { display:flex; flex-direction:column; gap:8px; }
.owed-row { display:flex; align-items:center; gap:10px; background:var(--card); border-radius:16px; padding:10px 12px; border-left:5px solid var(--c); }
.owed-row .ri { font-size:28px; } .owed-row .on { flex:1; display:flex; flex-direction:column; min-width:0; }
.owed-row .on b { font-size:17px; } .owed-row small { color:var(--mute); font-weight:700; font-size:13px; }
.kidtag { color:var(--c); font-weight:900; }
.owed-row.done { opacity:.55; } .owed-row.done b { text-decoration:line-through; }
.btn.sm { padding:8px 12px; font-size:14px; border-radius:12px; }
.waiting { background:color-mix(in srgb, #d9a400 14%, var(--card)); padding:10px 14px; border-radius:14px; font-weight:700 !important; }

/* tablet portrait / small */
@media (max-width: 1100px) { .v-today { grid-template-columns:1fr 1fr; } .v-today .sched { grid-row: span 2; } }
@media (max-width: 760px) {
  .app { grid-template-columns:1fr; grid-template-rows:minmax(0,1fr) auto; }
  .rail { order:2; flex-direction:row; justify-content:space-around; padding:6px 4px calc(6px + env(safe-area-inset-bottom)); border-right:0; border-top:1px solid var(--line); }
  .nav { padding:6px 8px; font-size:11px; }
  .title { display:none; }
  .top { padding:12px 14px 6px; gap:12px; } .clock { font-size:32px; } .chips { margin-left:0; width:100%; overflow-x:auto; flex-wrap:nowrap; }
  .chip { flex:none; }
  .body { padding:4px 12px 90px; }
  .v-today { grid-template-columns:1fr; }
  .v-week { display:block; } .week { display:flex; flex-direction:column; } .wcol { overflow:visible; } .wcol.pastday { display:none; }
  .month { gap:3px; } .mc { min-height:62px; padding:4px; } .mp { font-size:10px; padding:1px 4px; } .mp b { display:none; } .more { font-size:10px; }
  .fab { right:16px; bottom:84px; width:58px; height:58px; }
  .toast { bottom:90px; }
  .agenda { grid-template-columns:62px 5px 1fr; } .agenda .a-who { display:none; }
  .themebtn span { display:none; }
  .v-planner { padding-bottom:84px; }
  .planner { --plt:46px; --plc:118px; }
  .nav { padding:6px 4px; }
}
`;

/* ---------- visual editor ---------- */
const ED_PALETTE = ["#f6bf26", "#e67c73", "#4fc3f7", "#66bb6a", "#ab47bc", "#f48fb1", "#90a4ae", "#ff8a65", "#7986cb", "#4db6ac"];
const edEnt = (domain, multiple) => ({ entity: { filter: { domain }, ...(multiple ? { multiple: true } : {}) } });
const edSelect = (options) => ({ select: { mode: "dropdown", options } });
const edNum = (min, max, unit) => ({ number: { min, max, mode: "box", ...(unit ? { unit_of_measurement: unit } : {}) } });

const ED_LABELS = {
  title: "Title", weather_entity: "Weather", default_view: "Start on", theme: "Default theme",
  first_day: "Week starts on", idle_return_minutes: "Return to start view when idle",
  name: "Name", initials: "Initials", calendars: "Calendars", add_calendar: "New events go to",
  person: "Person (photo and home / away dot)", picture: "Picture URL", hide_pictures: "Use initials instead of photos", chores: "Chore list", stars: "Star counter",
  prefix_titles: "Title new events \"[Name] - Event\"", read_only: "Read only",
  entity: "To-do list", today: "Show on Today", today_list_items: "Items per list on Today", rewards_list: "Rewards list", rewards_owed_list: "Owed rewards list", parent_pin: "Parent PIN",
  planner_start_hour: "Day starts at (hour)", planner_end_hour: "Day ends at (hour)",
  planner_hour_height: "Hour height", planner_shared_name: "Shared column name",
  height_offset: "Height offset",
};
const ED_HELP = {
  idle_return_minutes: "0 turns this off",
  today: "Turn on for each list you want on the Today screen. They stack in order. With none on, the first list shows",
  picture: "Optional. Leave blank to use the person's photo from Home Assistant. Files in /config/www are /local/name.jpg",
  add_calendar: "Leave blank to use the first calendar",
  chores: "A Local To-do list. Each chore's description holds its time of day and stars, like \"morning 2⭐\"",
  stars: "A counter helper that holds this person's star balance",
  read_only: "Hidden from the New event picker",
  rewards_list: "A Local To-do list. Each item is a reward and its description is the cost, like \"10⭐\"",
  today_list_items: "When more than one list shows on Today, each shows this many items, then a \"+ more\" link",
  rewards_owed_list: "A Local To-do list. Each redeemed reward is added here until a parent marks it given",
  parent_pin: "Asked before editing chores or rewards. Leave blank for no PIN",
  planner_shared_name: "Defaults to the first shared calendar's name",
  height_offset: "Leave blank to size automatically",
  theme: "Each screen can still switch with the header button",
};

const ED_SCHEMA = {
  general: [
    { name: "title", selector: { text: {} } },
    { name: "weather_entity", selector: edEnt("weather") },
    { type: "grid", name: "", schema: [
      { name: "default_view", selector: edSelect(NAV.map((n) => ({ value: n.id, label: n.label }))) },
      { name: "theme", selector: edSelect(THEMES.map((t) => ({ value: t.id, label: `${t.icon} ${t.label}` }))) },
      { name: "first_day", selector: edSelect([{ value: "0", label: "Sunday" }, { value: "1", label: "Monday" }]) },
      { name: "idle_return_minutes", selector: edNum(0, 240, "min") },
    ] },
    { name: "hide_pictures", selector: { boolean: {} } },
  ],
  person: [
    { type: "grid", name: "", schema: [{ name: "name", required: true, selector: { text: {} } }, { name: "initials", selector: { text: {} } }] },
    { name: "calendars", selector: edEnt("calendar", true) },
    { name: "add_calendar", selector: edEnt("calendar") },
    { name: "person", selector: edEnt("person") },
    { name: "picture", selector: { text: {} } },
    { type: "grid", name: "", schema: [{ name: "chores", selector: edEnt("todo") }, { name: "stars", selector: edEnt("counter") }] },
    { name: "prefix_titles", selector: { boolean: {} } },
  ],
  shared: [
    { name: "name", required: true, selector: { text: {} } },
    { name: "calendars", selector: edEnt("calendar", true) },
    { name: "add_calendar", selector: edEnt("calendar") },
    { name: "read_only", selector: { boolean: {} } },
  ],
  list: [
    { type: "grid", name: "", schema: [{ name: "entity", required: true, selector: edEnt("todo") }, { name: "name", selector: { text: {} } }] },
    { name: "today", selector: { boolean: {} } },
  ],
  chores: [
    { name: "rewards_list", selector: edEnt("todo") },
    { name: "rewards_owed_list", selector: edEnt("todo") },
    { name: "parent_pin", selector: { text: { type: "password" } } },
  ],
  planner: [
    { type: "grid", name: "", schema: [
      { name: "planner_start_hour", selector: edNum(0, 23) },
      { name: "planner_end_hour", selector: edNum(1, 24) },
      { name: "planner_hour_height", selector: edNum(32, 160, "px") },
      { name: "planner_shared_name", selector: { text: {} } },
    ] },
  ],
  advanced: [{ name: "height_offset", selector: edNum(0, 400, "px") }],
};

const ED_ORDER = ["type", "title", "weather_entity", "default_view", "theme", "first_day", "idle_return_minutes", "hide_pictures", "people", "shared", "lists",
  "rewards_list", "rewards_owed_list", "rewards", "parent_pin", "planner_start_hour", "planner_end_hour", "planner_hour_height", "planner_shared_name", "height_offset", "today_list_items"];
const ED_ITEM_ORDER = ["name", "initials", "color", "calendars", "add_calendar", "person", "picture", "chores", "stars", "prefix_titles", "read_only", "entity", "today"];

const edClean = (o, order) => {
  const out = {};
  const keys = [...order.filter((k) => k in o), ...Object.keys(o).filter((k) => !order.includes(k))];
  keys.forEach((k) => {
    const v = o[k];
    if (v === undefined || v === null || v === "" || v === false || (Array.isArray(v) && !v.length && k !== "people")) return;
    out[k] = v;
  });
  return out;
};

class SkyFamCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._open = new Set(["general", "people"]);
    this._forms = [];
  }

  set hass(h) {
    this._hass = h;
    this._forms.forEach((f) => (f.el.hass = h));
  }

  setConfig(config) {
    const c = JSON.parse(JSON.stringify(config || {}));
    const item = (x) => {
      const o = typeof x === "string" ? { entity: x } : { ...x };
      if (o.entity && !o.calendars) { o.calendars = [o.entity]; delete o.entity; }
      if (typeof o.calendars === "string") o.calendars = [o.calendars];
      return o;
    };
    c.people = (c.people || []).map(item);
    c.shared = (c.shared || []).map(item);
    c.lists = (c.lists || []).map((l) => (typeof l === "string" ? { entity: l } : { ...l }));
    this._config = c;
    this._render();
  }

  connectedCallback() {
    if (customElements.get("ha-form") && customElements.get("ha-entity-picker")) return;
    // ha-form and the entity pickers are lazy loaded by the frontend; asking a built-in card for its editor loads them
    (async () => {
      try {
        const helpers = await window.loadCardHelpers();
        const c = await helpers.createCardElement({ type: "entities", entities: [] });
        await c.constructor.getConfigElement();
      } catch (e) { /* not inside Home Assistant */ }
      this._sig = null;
      this._render();
    })();
  }

  _emit() {
    const c = this._config;
    const out = edClean({
      ...c,
      people: c.people.map((p) => edClean(p, ED_ITEM_ORDER)),
      shared: c.shared.map((p) => edClean(p, ED_ITEM_ORDER)),
      lists: c.lists.map((l) => edClean(l, ED_ITEM_ORDER)),
    }, ED_ORDER);
    if (!out.type) out.type = "custom:skyfam-card";
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: out }, bubbles: true, composed: true }));
  }

  _label(s) { return ED_LABELS[s.name] || s.name; }
  _helper(s) { return ED_HELP[s.name]; }

  _form(slot, schema, getData, onChange) {
    const el = document.createElement("ha-form");
    el.hass = this._hass;
    el.schema = schema;
    el.data = getData();
    el.computeLabel = (s) => this._label(s);
    el.computeHelper = (s) => this._helper(s);
    el.addEventListener("value-changed", (ev) => { ev.stopPropagation(); onChange(ev.detail.value || {}); this._emit(); });
    slot.appendChild(el);
    this._forms.push({ el, getData });
  }

  _structSig() {
    const c = this._config;
    return [c.people.length, c.shared.length, c.lists.length].join("|");
  }

  _render() {
    if (!this._config) return;
    const sig = this._structSig();
    if (sig === this._sig) { this._refresh(); return; }
    this._sig = sig;
    this._forms = [];
    let c = this._config;
    const section = (id, title, sub, inner) => `<details class="sec" data-sec="${id}" ${this._open.has(id) ? "open" : ""}>
      <summary><span class="st">${title}</span><span class="ss">${sub}</span></summary><div class="sb">${inner}</div></details>`;
    const itemRow = (group, i, total, label, color, badges) => `<details class="item" data-sec="${group}-${i}" ${this._open.has(`${group}-${i}`) ? "open" : ""}>
      <summary>${color !== null ? `<input type="color" class="sw" data-color="${group}-${i}" value="${esc(color)}" title="Color">` : ""}
        <span class="nm" data-name="${group}-${i}">${esc(label)}</span><span class="badges" data-badges="${group}-${i}">${badges}</span>
        <span class="tools"><button data-move="${group}-${i}-up" ${i === 0 ? "disabled" : ""} title="Move up">▲</button><button data-move="${group}-${i}-down" ${i === total - 1 ? "disabled" : ""} title="Move down">▼</button><button class="del" data-del="${group}-${i}" title="Remove">✕</button></span>
      </summary><div class="ib" data-slot="${group}-${i}"></div></details>`;
    const items = (group, arr, addLabel) => arr.map((p, i) => itemRow(group, i, arr.length, this._itemLabel(group, p, i), group === "lists" ? null : p.color || ED_PALETTE[i % ED_PALETTE.length], this._badges(group, p))).join("")
      + `<button class="add" data-add="${group}">＋ ${addLabel}</button>`;

    this.shadowRoot.innerHTML = `<style>${SKYFAM_EDITOR_CSS}</style>
      ${section("general", "General", "Title, weather, start view, theme", `<div data-slot="general"></div>`)}
      ${section("people", "People", `${c.people.length} ${c.people.length === 1 ? "person" : "people"}, each with their own color and calendars`, items("people", c.people, "Add person"))}
      ${section("shared", "Shared calendars", "Family, birthdays, trash day and other calendars that aren't one person's", items("shared", c.shared, "Add shared calendar"))}
      ${section("lists", "Lists", "To-do lists for the Lists tab. Turn on \"Show on Today\" for the ones to stack on the Today screen", items("lists", c.lists, "Add list") + `<div data-slot="listopts"></div>`)}
      ${section("chores", "Chores and rewards", "Chore lists and star counters are set per person above", `<div data-slot="chores"></div>`)}
      ${section("planner", "Planner", "Hours shown in the Planner view", `<div data-slot="planner"></div>`)}
      ${section("advanced", "Advanced", "Layout tweaks", `<div data-slot="advanced"></div>`)}`;
    const root = this.shadowRoot;
    const slot = (k) => root.querySelector(`[data-slot="${k}"]`);
    const set = (val) => { Object.assign(this._config, val); };

    this._form(slot("general"), ED_SCHEMA.general,
      () => (c = this._config, { title: c.title, weather_entity: c.weather_entity, default_view: c.default_view || "today", theme: c.theme || "light", first_day: String(c.first_day ?? 0), idle_return_minutes: c.idle_return_minutes ?? 3, hide_pictures: !!c.hide_pictures }),
      (v) => {
        set({ ...v, first_day: Number(v.first_day) || 0 });
        if (this._config.default_view === "today") delete this._config.default_view;
        if (this._config.theme === "light") delete this._config.theme;
        if (!this._config.first_day) delete this._config.first_day;
      });
    this._form(slot("chores"), ED_SCHEMA.chores, () => (c = this._config, { rewards_list: c.rewards_list, rewards_owed_list: c.rewards_owed_list, parent_pin: c.parent_pin == null ? "" : String(c.parent_pin) }), set);
    this._form(slot("planner"), ED_SCHEMA.planner,
      () => (c = this._config, { planner_start_hour: c.planner_start_hour ?? 6, planner_end_hour: c.planner_end_hour ?? 22, planner_hour_height: c.planner_hour_height ?? 64, planner_shared_name: c.planner_shared_name }),
      (v) => {
        set(v);
        [["planner_start_hour", 6], ["planner_end_hour", 22], ["planner_hour_height", 64]].forEach(([k, d]) => { if (this._config[k] === d) delete this._config[k]; });
      });
    this._form(slot("listopts"), [{ name: "today_list_items", selector: edNum(1, 20) }],
      () => (c = this._config, { today_list_items: c.today_list_items ?? 5 }),
      (v) => { set(v); if (this._config.today_list_items === 5) delete this._config.today_list_items; });
    this._form(slot("advanced"), ED_SCHEMA.advanced, () => (c = this._config, { height_offset: c.height_offset }), set);

    [["people", ED_SCHEMA.person], ["shared", ED_SCHEMA.shared], ["lists", ED_SCHEMA.list]].forEach(([group, schema]) => {
      this._config[group].forEach((_, i) => {
        const s = slot(`${group}-${i}`);
        if (!s) return;
        this._form(s, schema, () => this._config[group][i], (v) => {
          this._config[group][i] = { ...this._config[group][i], ...v };
          this._refreshHeader(group, i);
        });
      });
    });

    root.querySelectorAll("details").forEach((d) => d.addEventListener("toggle", () => {
      d.open ? this._open.add(d.dataset.sec) : this._open.delete(d.dataset.sec);
    }));
    root.querySelectorAll("summary button, summary input").forEach((b) => b.addEventListener("click", (ev) => ev.stopPropagation()));
    root.querySelectorAll("summary button").forEach((b) => b.addEventListener("click", (ev) => { ev.preventDefault(); this._onTool(b); }));
    root.querySelectorAll(".add").forEach((b) => b.addEventListener("click", () => this._onAdd(b.dataset.add)));
    root.querySelectorAll("input.sw").forEach((inp) => inp.addEventListener("input", () => {
      const [group, i] = inp.dataset.color.split("-");
      this._config[group][Number(i)].color = inp.value;
      this._emit();
    }));
  }

  _itemLabel(group, p, i) {
    if (group === "lists") return p.name || (this._hass && p.entity && this._hass.states[p.entity] && this._hass.states[p.entity].attributes.friendly_name) || p.entity || `List ${i + 1}`;
    return p.name || `Untitled ${i + 1}`;
  }
  _badges(group, p) {
    if (group === "lists") return p.today ? `<span class="badge">📌 Today</span>` : "";
    const b = [];
    const n = (p.calendars || []).length;
    b.push(n ? `📅 ${n}` : `<span class="warn">No calendar</span>`);
    if (p.chores) b.push("⭐ chores");
    if (p.read_only) b.push("🔒");
    return b.map((x) => `<span class="badge">${x}</span>`).join("");
  }
  _refreshHeader(group, i) {
    const p = this._config[group][i];
    const nm = this.shadowRoot.querySelector(`[data-name="${group}-${i}"]`);
    if (nm) nm.textContent = this._itemLabel(group, p, i);
    const bd = this.shadowRoot.querySelector(`[data-badges="${group}-${i}"]`);
    if (bd) bd.innerHTML = this._badges(group, p);
  }
  _refresh() {
    this._forms.forEach((f) => { f.el.hass = this._hass; f.el.data = f.getData(); });
    ["people", "shared", "lists"].forEach((g) => this._config[g].forEach((p, i) => {
      this._refreshHeader(g, i);
      const sw = this.shadowRoot.querySelector(`[data-color="${g}-${i}"]`);
      if (sw && p.color && sw.value !== p.color) sw.value = p.color;
    }));
  }

  _onTool(b) {
    if (b.dataset.move) {
      const [group, i, dir] = b.dataset.move.split("-");
      const arr = this._config[group], a = Number(i), z = a + (dir === "up" ? -1 : 1);
      if (z < 0 || z >= arr.length) return;
      [arr[a], arr[z]] = [arr[z], arr[a]];
      const oa = this._open.has(`${group}-${a}`), oz = this._open.has(`${group}-${z}`);
      this._open.delete(`${group}-${a}`); this._open.delete(`${group}-${z}`);
      if (oa) this._open.add(`${group}-${z}`); if (oz) this._open.add(`${group}-${a}`);
    } else if (b.dataset.del) {
      const [group, i] = b.dataset.del.split("-");
      if (!b.classList.contains("sure")) {
        b.classList.add("sure"); b.textContent = "Remove?";
        setTimeout(() => { b.classList.remove("sure"); b.textContent = "✕"; }, 3000);
        return;
      }
      this._config[group].splice(Number(i), 1);
      [...this._open].filter((k) => k.startsWith(group + "-")).forEach((k) => this._open.delete(k));
    }
    this._sig = null;
    this._render();
    this._emit();
  }

  _onAdd(group) {
    const arr = this._config[group];
    const used = new Set([...this._config.people, ...this._config.shared].map((p) => p.color));
    const color = ED_PALETTE.find((c) => !used.has(c)) || ED_PALETTE[arr.length % ED_PALETTE.length];
    if (group === "people") arr.push({ name: `Person ${arr.length + 1}`, color, calendars: [] });
    if (group === "shared") arr.push({ name: "Family", color, calendars: [] });
    if (group === "lists") arr.push({ entity: "" });
    this._open.add(group);
    this._open.add(`${group}-${arr.length - 1}`);
    this._sig = null;
    this._render();
    this._emit();
  }
}

const SKYFAM_EDITOR_CSS = `
:host { display:block; }
details.sec { border:1px solid var(--divider-color, #e0e0e0); border-radius:12px; margin-bottom:12px; background:var(--card-background-color, #fff); }
details.sec > summary { position:relative; cursor:pointer; padding:14px 40px 14px 16px; display:flex; flex-direction:column; gap:2px; list-style:none; }
details.sec > summary::-webkit-details-marker, details.item > summary::-webkit-details-marker { display:none; }
details.sec > summary::after { content:"▾"; position:absolute; right:16px; top:16px; color:var(--secondary-text-color); transition:transform .2s; }
details.sec:not([open]) > summary::after { transform:rotate(-90deg); }
.st { font-weight:600; font-size:16px; color:var(--primary-text-color); }
.ss { font-size:13px; color:var(--secondary-text-color); }
.sb { padding:0 16px 16px; }
details.item { border:1px solid var(--divider-color, #e0e0e0); border-radius:10px; margin-bottom:8px; }
details.item > summary { cursor:pointer; display:flex; align-items:center; gap:10px; padding:8px 10px; list-style:none; }
details.item[open] > summary { border-bottom:1px solid var(--divider-color, #e0e0e0); }
.ib { padding:12px; }
.sw { width:30px; height:30px; padding:0; border:0; border-radius:50%; background:none; cursor:pointer; flex:none; }
.sw::-webkit-color-swatch-wrapper { padding:0; } .sw::-webkit-color-swatch { border:0; border-radius:50%; } .sw::-moz-color-swatch { border:0; border-radius:50%; }
.nm { font-weight:600; color:var(--primary-text-color); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.badges { display:flex; gap:4px; flex-wrap:wrap; }
.badge { font-size:12px; padding:2px 8px; border-radius:999px; background:var(--secondary-background-color, #f2f2f2); color:var(--secondary-text-color); white-space:nowrap; }
.warn { color:var(--warning-color, #d68000); }
.tools { display:flex; gap:2px; }
.tools button { border:0; background:none; cursor:pointer; color:var(--secondary-text-color); font-size:13px; padding:6px 8px; border-radius:8px; font:inherit; }
.tools button:hover:not(:disabled) { background:var(--secondary-background-color, #f2f2f2); }
.tools button:disabled { opacity:.3; cursor:default; }
.tools .del.sure { color:#fff; background:var(--error-color, #db4437); }
.add { border:1px dashed var(--divider-color, #ccc); background:none; border-radius:10px; width:100%; padding:10px; cursor:pointer; color:var(--primary-color, #03a9f4); font:inherit; font-weight:600; }
.add:hover { background:var(--secondary-background-color, #f5f5f5); }
`;

if (!customElements.get("skyfam-card-editor")) customElements.define("skyfam-card-editor", SkyFamCardEditor);
if (!customElements.get("skyfam-card")) {
  customElements.define("skyfam-card", SkyFamCard);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: "skyfam-card", name: "SkyFam family hub", preview: false, description: "Skylight-style calendar, chores, planner and lists", documentationURL: "https://github.com/muddro1/skyfam-card" });
  console.info(`%c SKYFAM %c ${SKYFAM_VERSION} `, "background:#3d6b8a;color:#fff;font-weight:700", "background:#f6f3ee;color:#3d6b8a");
}
