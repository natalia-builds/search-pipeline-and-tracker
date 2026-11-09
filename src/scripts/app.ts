// The interactive page. It keeps the person's library in memory, saves it to this browser after
// every change, and redraws the current section.
import { applicationFlags, HEADLINE_MAX, headlineChecks, resumeChecks, type Check } from "../lib/checks";
import { lineDiff, wordDiff } from "../lib/diff";
import { boldedMetrics, bulletCount, esc, plain, renderMarkdown, wordCount } from "../lib/markdown";
import { sampleLibrary } from "../lib/sample";
import { backupFilename, exportBackup, loadLibrary, parseBackup, saveLibrary, STORAGE_KEY, type KeyValueStore } from "../lib/storage";
import { BONUS_OPTIONS, emptyLibrary, MAX_PAGE_LIMIT, STATUSES, type Application, type Contact, type Library, type Settings } from "../lib/types";

const $ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s);
const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

/* ---------- small browser helpers ---------- */
function browserStore(): KeyValueStore | null {
  try {
    const s = window.localStorage;
    s.getItem(STORAGE_KEY);
    return s;
  } catch {
    return null;
  }
}
const store = browserStore();
// Per-device conveniences (open section, drafts). Losing these is harmless.
const pref = {
  get: (k: string) => {
    try {
      return store?.getItem("spt." + k) ?? null;
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      store?.setItem("spt." + k, v);
    } catch {}
  },
  del: (k: string) => {
    try {
      (store as Storage | null)?.removeItem("spt." + k);
    } catch {}
  },
};
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const fmtDate = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso + "T12:00:00").getTime()) / 86400000);

/* ---------- state ---------- */
type Section = "resume" | "apps" | "contacts" | "headline" | "settings";
type ResumeTab = "preview" | "edit" | "history" | "compare";
const SECTIONS: Section[] = ["resume", "apps", "contacts", "headline", "settings"];
const loaded = loadLibrary(store);
let lib: Library = loaded.library;
const hashSection = location.hash.replace("#", "") as Section;
const S = {
  section: (SECTIONS.includes(hashSection) ? hashSection : (pref.get("section") as Section)) || "resume",
  tab: ((pref.get("tab") as ResumeTab) || "preview") as ResumeTab,
  view: null as string | null,
  cmpA: null as string | null,
  cmpB: null as string | null,
  filter: pref.get("filter") || "Active",
  editing: null as string | null,
  confirmDel: null as string | null,
  editingC: null as string | null,
  confirmDelC: null as string | null,
  shareFor: null as string | null,
  cFilter: "",
  hlEditing: false,
  hlCmpA: null as string | null,
  hlCmpB: null as string | null,
  delV: null as string | null,
  delH: null as string | null,
  confirmWipe: false,
  pendingRestore: null as Library | null,
  settingsErrors: [] as { id: string; msg: string }[],
  /** What was typed in the settings form, kept while there are errors so nothing is lost. */
  settingsDraft: null as Record<string, string> | null,
  loadError: loaded.error,
  saveError: null as string | null,
};
if (!SECTIONS.includes(S.section)) S.section = "resume";
// If saved data couldn't be read, keep a copy under another key before anything can overwrite it.
if (loaded.error && loaded.raw) {
  try {
    store?.setItem(STORAGE_KEY + ".unreadable", loaded.raw);
  } catch {}
}

/** Applies a change, saves it, and redraws. */
function commit(change: (l: Library) => void, message?: string) {
  const next: Library = structuredClone(lib);
  change(next);
  const err = saveLibrary(store, next);
  if (err) {
    S.saveError = err;
    announce(err + " Download a backup so you don't lose your work.");
    render();
    return false;
  }
  lib = next;
  S.saveError = null;
  requestPersistence();
  render();
  if (message) announce(message);
  return true;
}
let askedPersist = false;
function requestPersistence() {
  // Asks the browser not to clear this site's data when space runs low. Browsers may say no.
  if (askedPersist) return;
  askedPersist = true;
  navigator.storage?.persist?.().catch(() => {});
}

/* ---------- lookups ---------- */
const versions = () => lib.versions.slice().sort((a, b) => a.n - b.n);
const vById = (id: string | null) => lib.versions.find((v) => v.id === id) || null;
const current = () => vById(lib.currentVersion) || versions().slice(-1)[0] || null;
const appsFor = (vid: string) => lib.applications.filter((a) => a.versionId === vid);
const sharedWith = (vid: string) => lib.contacts.filter((c) => c.shares.some((s) => s.versionId === vid));
const lastShare = (c: Contact) => c.shares.slice().sort((a, b) => b.date.localeCompare(a.date))[0] || null;
const hlSorted = () => lib.headlines.slice().sort((a, b) => a.n - b.n);
const hlById = (id: string | null) => lib.headlines.find((h) => h.id === id) || null;
const curHeadline = () => hlById(lib.currentHeadline) || hlSorted().slice(-1)[0] || null;
const hasData = () => !!(lib.versions.length || lib.applications.length || lib.contacts.length || lib.headlines.length);
const DRAFT = "draft.resume";
const HL_DRAFT = "draft.headline";

/* ---------- announcements ---------- */
let announceTimer: number | undefined;
function announce(msg: string) {
  const el = $("#status");
  if (!el) return;
  el.textContent = "";
  // A short pause makes screen readers read the same message again if it repeats.
  window.setTimeout(() => (el.textContent = msg), 30);
  window.clearTimeout(announceTimer);
  announceTimer = window.setTimeout(() => (el.textContent = ""), 8000);
}

/* ---------- shared pieces ---------- */
const LEVEL_WORD = { ok: "Passed", warn: "Check", fail: "Problem" };
const checksCard = (list: Check[], title = "Checks") =>
  `<section class="card" aria-label="${esc(title)}"><h3 class="card-h">${esc(title)}</h3>${
    list.length
      ? list.map((x) => `<div class="check"><span class="dot ${x.level}" aria-hidden="true"></span><span><span class="sr-only">${LEVEL_WORD[x.level]}: </span>${esc(x.text)}</span></div>`).join("")
      : `<p class="hint">No checks set up yet. Add your own in <button class="link" data-section="settings">Settings</button>.</p>`
  }</section>`;

function sideHtml(md: string) {
  const mx = boldedMetrics(md);
  return `<div class="side">
    ${checksCard(resumeChecks(md, lib.settings))}
    <section class="card" aria-label="Size"><h3 class="card-h">Size</h3><div class="stats">
      <div><b>${wordCount(md)}</b><span>words</span></div>
      <div><b>${plain(md).length.toLocaleString()}</b><span>characters</span></div>
      <div><b>${bulletCount(md)}</b><span>bullets</span></div></div></section>
    <section class="card" aria-label="Bolded numbers"><h3 class="card-h">Bolded numbers (${mx.length})</h3><div class="chips">${
      mx.map((m) => `<span class="chip">${esc(m)}</span>`).join("") || '<span class="hint">None bolded.</span>'
    }</div></section>
  </div>`;
}

function sentTo(vid: string) {
  const list = appsFor(vid);
  const cs = sharedWith(vid);
  const parts: string[] = [];
  if (list.length) parts.push(`<span class="hint">Applications: ${list.map((a) => `<button class="link" data-act="openapp" data-id="${esc(a.id)}">${esc(a.company)}</button>`).join(", ")}</span>`);
  if (cs.length) parts.push(`<span class="hint">Shared with: ${cs.map((c) => `<button class="link" data-act="opencontact" data-id="${esc(c.id)}">${esc(c.name)}</button>`).join(", ")}</span>`);
  return parts.join("");
}

const versionOption = (v: { id: string; label: string; createdAt: string; note: string }, selected: boolean) =>
  `<option value="${esc(v.id)}"${selected ? " selected" : ""}>${esc(v.label)} - ${fmtDate(v.createdAt)}${v.note ? " - " + esc(v.note.slice(0, 36)) : ""}</option>`;

const pages = (n: number) => `${n} page${n === 1 ? "" : "s"}`;
function pageLimitOptions() {
  const cur = lib.settings.pageLimit;
  const opts = [`<option value="0"${cur === 0 ? " selected" : ""}>No limit</option>`];
  for (let n = 1; n <= MAX_PAGE_LIMIT; n++) opts.push(`<option value="${n}"${cur === n ? " selected" : ""}>${pages(n)}</option>`);
  return opts.join("");
}

/* ---------- header, nav and banners ---------- */
function renderNav() {
  const active = lib.applications.filter((a) => a.status !== "Closed").length;
  const items: [Section, string, string][] = [
    ["resume", "Resume", current()?.label || ""],
    ["apps", "Applications", String(active)],
    ["contacts", "Contacts", String(lib.contacts.length)],
    ["headline", "LinkedIn headline", curHeadline()?.label || ""],
    ["settings", "Settings and backup", ""],
  ];
  $("#nav")!.innerHTML = items
    .map(([id, name, n]) => `<button class="mtab" data-section="${id}"${S.section === id ? ' aria-current="page"' : ""}>${name}${n ? `<span class="n">${esc(n)}</span>` : ""}</button>`)
    .join("");
}

function bannersHtml() {
  const out: string[] = [];
  if (S.loadError)
    out.push(
      `<div class="banner danger" role="alert"><span>${esc(S.loadError)} A copy was set aside so it isn't lost. Restore a backup in Settings, or download the copy to ask for help.</span>${loaded.raw ? `<button class="btn small" data-act="rawcopy">Download the copy</button>` : ""}</div>`,
    );
  if (S.saveError) out.push(`<div class="banner danger" role="alert"><span>${esc(S.saveError)}</span><button class="btn small" data-act="backup">Download backup</button></div>`);
  if (!store) out.push(`<div class="banner danger" role="alert"><span>This browser is blocking saved data (often because of private browsing), so nothing you enter will be kept.</span></div>`);
  const stale = !lib.lastBackupAt || daysSince(lib.lastBackupAt.slice(0, 10)) >= 14;
  if (hasData() && stale && S.section !== "settings")
    out.push(
      `<div class="banner"><span>${lib.lastBackupAt ? `Your last backup was ${fmtDate(lib.lastBackupAt)}.` : "You haven't saved a backup yet."} Your data lives only in this browser, so a backup file keeps it safe.</span><button class="btn small" data-act="backup">Download backup</button></div>`,
    );
  return out.join("");
}

/* ---------- resume ---------- */
function welcomeHtml() {
  return `<div class="empty-state">
    <h3>Start with your resume</h3>
    <p>Paste your resume into the editor and save it as your first version. Each time you tailor it, save a new version, then link it to the application or person it went to.</p>
    <p>Everything you enter stays in this browser on this device. Nothing is sent anywhere.</p>
    <div class="bar"><button class="btn primary" data-tab="edit">Paste your resume</button><button class="btn" data-act="sample">Try it with sample data</button><button class="btn" data-section="settings">Restore a backup</button></div>
  </div>`;
}

function delVControl(vid: string, curId: string) {
  const v = vById(vid)!;
  if (vid === curId) return `<span class="hint">The current version can't be deleted</span>`;
  const uses = [...appsFor(vid).map((a) => a.company), ...sharedWith(vid).map((c) => c.name)];
  if (uses.length) return `<span class="hint">Kept: sent to ${esc(uses.join(", "))}</span>`;
  if (S.delV === vid)
    return `<span class="hint">Delete ${esc(v.label)} permanently?</span><button class="btn small danger" data-act="delv" data-id="${esc(vid)}">Delete</button><button class="btn small" data-act="nodelv" data-id="${esc(vid)}">Keep</button>`;
  return `<button class="btn small danger" data-act="askdelv" data-id="${esc(vid)}">Delete ${esc(v.label)}</button>`;
}

function resumeHtml() {
  const vs = versions();
  const cur = current();
  const head = `<div class="work-head"><div><h2>Resume</h2><p class="sub">Save a new version whenever you tailor it, then link that version to where it went.</p></div>
    <div class="bar">${cur ? `<span class="pill">Current: ${esc(cur.label)}</span><span class="pill muted">${fmtDate(cur.createdAt)}</span>` : ""}</div></div>`;
  const tabs: [ResumeTab, string][] = [
    ["preview", "Preview"],
    ["edit", "Edit"],
    ["history", `History (${vs.length})`],
    ["compare", "Compare"],
  ];
  const tabBar = `<div class="tabs" role="group" aria-label="Resume views">${tabs.map(([t, name]) => `<button class="tab" data-tab="${t}"${S.tab === t ? ' aria-current="true"' : ""}>${name}</button>`).join("")}</div>`;
  if (!cur && S.tab !== "edit") return head + welcomeHtml();

  let body = "";
  if (S.tab === "preview" && cur) {
    const v = vById(S.view) || cur;
    const old = v.id !== cur.id;
    body = `${old ? `<div class="banner"><span>Viewing ${esc(v.label)} from ${fmtDate(v.createdAt)}. The current version is ${esc(cur.label)}.</span><span class="bar"><button class="btn small" data-act="setcur" data-id="${esc(v.id)}">Make ${esc(v.label)} current</button><button class="btn small" data-act="viewcur">Back to current</button></span></div>` : ""}
      <div class="bar"><button class="btn primary" data-act="pdf" data-id="${esc(v.id)}">Download PDF</button>
        <label class="inline-select">Page limit <select class="f" id="pageLimit">${pageLimitOptions()}</select></label>
        <button class="btn" data-act="copy" data-id="${esc(v.id)}">Copy as plain text</button><button class="btn" data-act="toedit" data-id="${esc(v.id)}">Edit from this version</button></div>
      <div class="bar">${v.note ? `<span class="hint">${esc(v.label)}: ${esc(v.note)}</span>` : ""}${sentTo(v.id)}</div>
      <div class="cols"><article class="sheet" aria-label="Resume ${esc(v.label)}">${renderMarkdown(v.content)}</article>${sideHtml(v.content)}</div>`;
  } else if (S.tab === "edit") {
    const draft = pref.get(DRAFT);
    const text = draft ?? (cur ? cur.content : "");
    const nextN = (vs.slice(-1)[0]?.n || 0) + 1;
    const openApps = lib.applications.filter((a) => a.status !== "Closed");
    body = `<div class="cols"><div class="editor">
        ${draft != null && cur && draft !== cur.content ? `<div class="banner"><span>Unsaved draft based on ${esc(cur.label)}. Drafts stay in this browser until you save a version.</span><button class="btn small" data-act="discard">Discard draft</button></div>` : ""}
        <label for="ed" class="field-label">Resume text</label>
        <p class="hint" id="edHint">Use # for headings, * for bullets, **double asterisks** for bold, and a tab between a job title and its dates.</p>
        <textarea id="ed" spellcheck="true" aria-describedby="edHint">${esc(text)}</textarea>
        <div class="savebar">
          <label>Version name<input class="f" id="vLabel" value="v${nextN}"></label>
          <label>What changed?<input class="f" id="vNote" placeholder="e.g. Led with payments results"></label>
          <label>Tailored for<select class="f" id="vApp"><option value="">Not tied to an application</option>${openApps.map((a) => `<option value="${esc(a.id)}">${esc(a.company)} - ${esc(a.role)}</option>`).join("")}</select></label>
          <button class="btn primary" data-act="savev">Save version</button>
        </div>
      </div><div id="liveSide">${sideHtml(text)}</div></div>`;
  } else if (S.tab === "history" && cur) {
    body = `<div class="hist">${vs
      .slice()
      .reverse()
      .map(
        (v) => `<div class="hrow">
        <span class="hlabel">${esc(v.label)}</span>
        <div><span class="hdate">${fmtDate(v.createdAt)}</span> ${v.id === cur.id ? '<span class="pill">current</span>' : ""}<p class="hnote">${esc(v.note || "No note")}</p>${sentTo(v.id)}</div>
        <div class="bar"><button class="btn small" data-act="view" data-id="${esc(v.id)}">Preview ${esc(v.label)}</button>
        ${v.id !== cur.id ? `<button class="btn small" data-act="setcur" data-id="${esc(v.id)}">Make current</button><button class="btn small" data-act="cmpcur" data-id="${esc(v.id)}">Compare with current</button>` : ""}
        <button class="btn small" data-act="toedit" data-id="${esc(v.id)}">Edit from this</button>${delVControl(v.id, cur.id)}</div></div>`,
      )
      .join("")}</div>`;
  } else if (cur) {
    if (vs.length < 2) return head + tabBar + `<div class="empty-state"><h3>Only one version so far</h3><p>Once you save a second version, you can compare any two here.</p></div>`;
    const a = vById(S.cmpA) || vs[vs.length - 2];
    const b = vById(S.cmpB) || cur;
    const opts = (sel: string) => vs.slice().reverse().map((v) => versionOption(v, v.id === sel)).join("");
    const d = lineDiff(a.content, b.content);
    body = `<div class="cmp-pick"><label for="cmpA">Older<select class="f" id="cmpA">${opts(a.id)}</select></label><label for="cmpB">Newer<select class="f" id="cmpB">${opts(b.id)}</select></label></div>
      <div class="bar"><span class="pill add">${d.add} lines added</span><span class="pill del">${d.del} lines removed</span><span class="hint">Unchanged stretches are collapsed.</span></div>
      <div class="diff">${d.html || '<div class="gap">These versions are identical.</div>'}</div>`;
  }
  return head + tabBar + body;
}

/* ---------- applications ---------- */
function appForm(a: Application | null) {
  const isNew = !a;
  const vs = versions().slice().reverse();
  const cur = current();
  const val = (k: keyof Application) => esc(a?.[k] ?? "");
  const sel = (id: string, list: readonly string[], v: string) => `<select class="f" id="${id}">${list.map((x) => `<option${x === v ? " selected" : ""}>${esc(x)}</option>`).join("")}</select>`;
  const setups = lib.settings.workSetups.includes(a?.setup || "") || !a?.setup ? lib.settings.workSetups : [...lib.settings.workSetups, a.setup];
  return `<form class="appform${isNew ? " top" : ""}" novalidate id="appForm" data-id="${esc(a?.id || "new")}" aria-label="${isNew ? "New application" : "Edit " + esc(a.company)}">
    <label>Company<input class="f" id="fCompany" required value="${val("company")}"></label>
    <label>Role<input class="f" id="fRole" required value="${val("role")}"></label>
    <label>Status${sel("fStatus", STATUSES, a?.status || "Applied")}</label>
    <label>Date applied<input class="f" type="date" id="fApplied" value="${a ? val("appliedOn") : today()}"></label>
    <label>Resume version sent<select class="f" id="fVersion"><option value="">None yet</option>${vs.map((v) => versionOption(v, (a ? a.versionId : cur?.id) === v.id)).join("")}</select></label>
    <label>Work setup${sel("fSetup", setups, a?.setup || setups[0] || "")}</label>
    <label>Posted pay range<input class="f" id="fBase" placeholder="e.g. $150K - $180K" value="${val("base")}"></label>
    <label>Bonus or variable pay${sel("fBonus", BONUS_OPTIONS, a?.bonus || "Unknown")}</label>
    <label>Next step<input class="f" id="fNext" placeholder="e.g. Hiring manager screen" value="${val("nextStep")}"></label>
    <label>Next step date<input class="f" type="date" id="fNextDate" value="${val("nextDate")}"></label>
    <label>Referral or contact<input class="f" id="fContact" value="${val("contact")}"></label>
    <label>Posting link<input class="f" id="fUrl" type="url" placeholder="https://" value="${val("url")}"></label>
    <label class="wide">Notes<textarea class="f" id="fNotes" rows="3" placeholder="Reporting line, questions to ask">${val("notes")}</textarea></label>
    <div class="bar wide"><button class="btn primary" type="submit">${isNew ? "Add application" : "Save changes"}</button><button class="btn" type="button" data-act="cancelapp">Cancel</button><span class="spacer"></span>
      ${!isNew ? (S.confirmDel === a.id ? `<span class="hint">Delete this application?</span><button class="btn small danger" type="button" data-act="delapp" data-id="${esc(a.id)}">Delete</button><button class="btn small" type="button" data-act="nodel" data-id="${esc(a.id)}">Keep</button>` : `<button class="btn small danger" type="button" data-act="askdel" data-id="${esc(a.id)}">Delete application</button>`) : ""}</div>
  </form>`;
}

function appsHtml() {
  const apps = lib.applications;
  const active = apps.filter((a) => a.status !== "Closed").length;
  const stages: [string, number][] = [["Active", active], ...STATUSES.map((s) => [s, apps.filter((a) => a.status === s).length] as [string, number])];
  const list = apps
    .filter((a) => S.filter === "All" || (S.filter === "Active" ? a.status !== "Closed" : a.status === S.filter))
    .sort((a, b) => Number(a.status === "Closed") - Number(b.status === "Closed") || b.updatedAt.localeCompare(a.updatedAt));
  const head = `<div class="work-head"><div><h2>Applications</h2><p class="sub">Each role you pursue, where it stands, and the resume version you sent.</p></div>
    <div class="bar"><button class="btn primary" data-act="newapp">Add application</button></div></div>`;
  const pipe = `<div class="pipeline" role="group" aria-label="Filter by stage">${stages
    .map(([s, n]) => `<button class="stage" data-filter="${s}" aria-pressed="${S.filter === s}"><b>${n}</b><span>${s}</span><span class="bar-c" style="background:${s === "Active" ? "var(--accent)" : `var(--st-${s.toLowerCase()})`}"></span></button>`)
    .join("")}</div>`;
  const rows = list
    .map((a) => {
      const v = vById(a.versionId);
      const flags = applicationFlags(a, lib.settings, today());
      const row = `<div class="app" id="app-${esc(a.id)}">
        <div class="c-main"><h3 class="co-name">${esc(a.company)}</h3><div class="role">${esc(a.role)}</div>
          ${flags.length ? `<div class="flags">${flags.map((f) => `<span class="pill warn">${esc(f)}</span>`).join("")}</div>` : ""}</div>
        <div class="meta c-mid"><span>Applied <b>${a.appliedOn ? fmtDate(a.appliedOn) : "-"}</b></span>
          <span>Resume ${v ? `<button class="link" data-act="viewver" data-id="${esc(v.id)}">${esc(v.label)}</button>` : "<b>not linked</b>"}${a.base ? ` · Pay <b>${esc(a.base)}</b>` : ""}</span>
          <span>${esc(a.setup)}${a.contact ? " · " + esc(a.contact) : ""}</span></div>
        <div class="meta c-next">${a.nextStep ? `<span>Next: <b>${esc(a.nextStep)}</b></span>` : `<span>No next step set</span>`}${a.nextDate ? `<span>${fmtDate(a.nextDate)}</span>` : ""}
          ${/^https?:\/\//i.test(a.url) ? `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer" class="link">Job posting<span class="sr-only"> for ${esc(a.company)} (opens in a new tab)</span></a>` : ""}</div>
        <div class="bar end"><span class="status s-${esc(a.status)}">${esc(a.status)}</span><button class="btn small" data-act="editapp" data-id="${esc(a.id)}" aria-expanded="${S.editing === a.id}">${S.editing === a.id ? "Close" : "Edit"}<span class="sr-only"> ${esc(a.company)}</span></button></div>
      </div>`;
      return row + (S.editing === a.id ? appForm(a) : "");
    })
    .join("");
  const empty = !apps.length
    ? `<div class="empty-state"><h3>No applications yet</h3><p>Add a role when you start pursuing it. Link the resume version you sent so you can see later exactly what each company received.</p><button class="btn primary" data-act="newapp">Add your first application</button></div>`
    : !list.length
      ? `<div class="empty-state"><h3>None in ${esc(S.filter)}</h3><p>Pick another stage above to see the rest.</p></div>`
      : "";
  return head + pipe + (S.editing === "new" ? appForm(null) : "") + (list.length ? `<div class="apps">${rows}</div>` : empty);
}

/* ---------- contacts ---------- */
function contactForm(c: Contact | null) {
  const isNew = !c;
  const val = (k: keyof Contact) => esc((c?.[k] as string) ?? "");
  const cur = current();
  const vs = versions().slice().reverse();
  return `<form class="appform${isNew ? " top" : ""}" novalidate id="contactForm" data-id="${esc(c?.id || "new")}" aria-label="${isNew ? "New contact" : "Edit " + esc(c.name)}">
    <label>Name<input class="f" id="cName" required value="${val("name")}"></label>
    <label>Company<input class="f" id="cCompany" value="${val("company")}"></label>
    <label>Title<input class="f" id="cTitle" value="${val("title")}"></label>
    <label>How you know them<input class="f" id="cRel" list="relList" value="${val("relationship")}">
      <datalist id="relList">${lib.settings.relationships.map((r) => `<option value="${esc(r)}">`).join("")}</datalist></label>
    <label>Email or LinkedIn<input class="f" id="cReach" value="${val("reach")}"></label>
    <label>Follow up on<input class="f" type="date" id="cFollow" value="${val("followUp")}"></label>
    ${isNew ? `<label>Resume version shared<select class="f" id="cVersion"><option value="">Not shared yet</option>${vs.map((v) => versionOption(v, v.id === cur?.id)).join("")}</select></label>
    <label>Date shared<input class="f" type="date" id="cDate" value="${today()}"></label>` : ""}
    <label class="wide">Notes<textarea class="f" id="cNotes" rows="2" placeholder="What you asked for, roles they might know about">${val("notes")}</textarea></label>
    <div class="bar wide"><button class="btn primary" type="submit">${isNew ? "Add contact" : "Save changes"}</button><button class="btn" type="button" data-act="cancelc">Cancel</button><span class="spacer"></span>
      ${!isNew ? (S.confirmDelC === c.id ? `<span class="hint">Delete this contact and their share history?</span><button class="btn small danger" type="button" data-act="delc" data-id="${esc(c.id)}">Delete</button><button class="btn small" type="button" data-act="nodelc" data-id="${esc(c.id)}">Keep</button>` : `<button class="btn small danger" type="button" data-act="askdelc" data-id="${esc(c.id)}">Delete contact</button>`) : ""}</div>
  </form>`;
}

function shareForm(c: Contact) {
  const cur = current();
  const vs = versions().slice().reverse();
  return `<form class="shareform" id="shareForm" data-id="${esc(c.id)}" aria-label="Log a resume shared with ${esc(c.name)}">
    <label>Version<select class="f" id="sVersion">${vs.map((v) => versionOption(v, v.id === cur?.id)).join("")}</select></label>
    <label>Date<input class="f" type="date" id="sDate" value="${today()}"></label>
    <label>Note<input class="f" id="sNote" placeholder="e.g. Sent after coffee chat"></label>
    <button class="btn primary" type="submit">Log share</button><button class="btn" type="button" data-act="cancelshare">Cancel</button>
  </form>`;
}

function contactsHtml() {
  const q = S.cFilter.trim().toLowerCase();
  const list = lib.contacts
    .filter((c) => !q || [c.name, c.company, c.title, c.relationship].some((x) => x.toLowerCase().includes(q)))
    .sort((a, b) => (lastShare(b)?.date || b.createdAt).localeCompare(lastShare(a)?.date || a.createdAt));
  const cur = current();
  const behind = lib.contacts.filter((c) => {
    const l = lastShare(c);
    return l && cur && l.versionId !== cur.id;
  }).length;
  const due = lib.contacts.filter((c) => c.followUp && c.followUp <= today()).length;
  const head = `<div class="work-head"><div><h2>Contacts</h2><p class="sub">People you've shared your resume with outside an application, and which versions each one has.</p></div>
    <div class="bar"><button class="btn primary" data-act="newc">Add contact</button></div></div>`;
  const summary = lib.contacts.length
    ? `<div class="bar"><label class="search"><span class="sr-only">Search contacts</span><input class="f" id="cSearch" type="search" placeholder="Search by name, company, or relationship" value="${esc(S.cFilter)}"></label>
      <span class="spacer"></span>${cur && behind ? `<span class="pill warn">${behind} have an older version than ${esc(cur.label)}</span>` : ""}${due ? `<span class="pill warn">${due} follow-up${due > 1 ? "s" : ""} due</span>` : ""}</div>`
    : "";
  const rows = list
    .map((c) => {
      const shares = c.shares.slice().sort((a, b) => b.date.localeCompare(a.date));
      const l = shares[0];
      const older = l && cur && l.versionId !== cur.id;
      const fu = c.followUp ? `<span${c.followUp <= today() ? ' class="stale"' : ""}>Follow up ${fmtDate(c.followUp)}${c.followUp <= today() ? " (due)" : ""}</span>` : "";
      const flags = [c.relationship ? `<span class="pill muted">${esc(c.relationship)}</span>` : "", older ? `<span class="pill warn">Has ${esc(vById(l.versionId)?.label || "an older version")}, current is ${esc(cur!.label)}</span>` : ""].join("");
      const row = `<div class="app" id="contact-${esc(c.id)}">
        <div class="c-main"><h3 class="co-name">${esc(c.name)}</h3><div class="role">${esc([c.title, c.company].filter(Boolean).join(", "))}</div>${flags ? `<div class="flags">${flags}</div>` : ""}</div>
        <div class="shares c-mid">${
          shares.length
            ? shares
                .map((s) => {
                  const v = vById(s.versionId);
                  return `<div class="sh">${v ? `<button class="link" data-act="viewver" data-id="${esc(v.id)}">${esc(v.label)}</button>` : "<b>deleted version</b>"}<span>${fmtDate(s.date)}</span>${s.note ? `<span>${esc(s.note)}</span>` : ""}<button class="x" data-act="rmshare" data-id="${esc(c.id)}" data-sid="${esc(s.id)}">remove<span class="sr-only"> this share</span></button></div>`;
                })
                .join("")
            : "<span>No resume shared yet</span>"
        }</div>
        <div class="meta c-next">${c.reach ? `<span>${esc(c.reach)}</span>` : ""}${fu}${l ? `<span>Last shared ${daysSince(l.date) <= 0 ? "today" : daysSince(l.date) + " days ago"}</span>` : ""}</div>
        <div class="bar end"><button class="btn small" data-act="shareto" data-id="${esc(c.id)}" aria-expanded="${S.shareFor === c.id}">${S.shareFor === c.id ? "Close" : "Log share"}<span class="sr-only"> with ${esc(c.name)}</span></button><button class="btn small" data-act="editc" data-id="${esc(c.id)}" aria-expanded="${S.editingC === c.id}">${S.editingC === c.id ? "Close" : "Edit"}<span class="sr-only"> ${esc(c.name)}</span></button></div>
      </div>`;
      return row + (S.shareFor === c.id ? shareForm(c) : "") + (S.editingC === c.id ? contactForm(c) : "");
    })
    .join("");
  const empty = !lib.contacts.length
    ? `<div class="empty-state"><h3>No contacts yet</h3><p>Add someone when you send them your resume, such as a former colleague who offered to pass it along. Each share records the version and date, so you know what they have if your resume changes later.</p><button class="btn primary" data-act="newc">Add your first contact</button></div>`
    : !list.length
      ? `<div class="empty-state"><h3>No matches</h3><p>No contact matches "${esc(S.cFilter)}".</p></div>`
      : "";
  return head + summary + (S.editingC === "new" ? contactForm(null) : "") + (list.length ? `<div class="apps">${rows}</div>` : empty);
}

/* ---------- LinkedIn headline ---------- */
function hlChecks(text: string) {
  const cur = current();
  return headlineChecks(text, lib.settings, cur ? { label: cur.label, content: cur.content } : null);
}
function delHControl(id: string, curId: string) {
  const h = hlById(id)!;
  if (id === curId) return `<span class="hint">The current headline can't be deleted</span>`;
  if (S.delH === id)
    return `<span class="hint">Delete ${esc(h.label)} permanently?</span><button class="btn small danger" data-act="delh" data-id="${esc(id)}">Delete</button><button class="btn small" data-act="nodelh" data-id="${esc(id)}">Keep</button>`;
  return `<button class="btn small danger" data-act="askdelh" data-id="${esc(id)}">Delete ${esc(h.label)}</button>`;
}
function headlineHtml() {
  const hs = hlSorted();
  const cur = curHeadline();
  const head = `<div class="work-head"><div><h2>LinkedIn headline</h2><p class="sub">Every headline you've used, when it changed, and why. LinkedIn allows ${HEADLINE_MAX} characters.</p></div>
    <div class="bar">${cur ? `<span class="pill">Current: ${esc(cur.label)}</span>` : ""}<button class="btn primary" data-act="hlnew" aria-expanded="${S.hlEditing}">${S.hlEditing ? "Close editor" : "New version"}</button></div></div>`;
  let editor = "";
  if (S.hlEditing) {
    const text = pref.get(HL_DRAFT) ?? (cur ? cur.text : "");
    const len = [...text].length;
    editor = `<div class="cols"><div class="editor">
      <label for="hlEd" class="field-label">Headline</label>
      <textarea id="hlEd" maxlength="400" aria-describedby="hlCount">${esc(text)}</textarea>
      <div class="bar"><span class="count${len > HEADLINE_MAX ? " over" : ""}" id="hlCount">${len} of ${HEADLINE_MAX} characters</span></div>
      <div class="savebar three">
        <label>Version name<input class="f" id="hlLabel" value="v${(hs.slice(-1)[0]?.n || 0) + 1}"></label>
        <label>Why the change?<input class="f" id="hlNote" placeholder="e.g. Lead with payments for fintech roles"></label>
        <button class="btn primary" data-act="hlsave">Save version</button></div>
    </div><div id="hlSide" class="side">${checksCard(hlChecks(text))}</div></div>`;
  }
  if (!cur) return head + editor + (S.hlEditing ? "" : `<div class="empty-state"><h3>No headline saved yet</h3><p>Paste your current LinkedIn headline as v1, then save a new version each time you change it.</p><button class="btn primary" data-act="hlnew">Add your headline</button></div>`);
  const s = lib.settings;
  const preview = `<div class="cols"><div class="li-card">${s.name ? `<span class="li-name">${esc(s.name)}</span>` : ""}<span class="li-head">${esc(cur.text)}</span>${s.location ? `<span class="li-loc">${esc(s.location)}</span>` : ""}
      <div class="bar"><button class="btn" data-act="hlcopy" data-id="${esc(cur.id)}">Copy headline</button><span class="count">${[...cur.text].length} of ${HEADLINE_MAX} characters</span>${cur.note ? `<span class="hint">${esc(cur.label)}: ${esc(cur.note)}</span>` : ""}</div></div>
    <div class="side">${checksCard(hlChecks(cur.text))}</div></div>`;
  const hist = `<h3 class="sec-h">History (${hs.length})</h3>
    <div class="hist">${hs
      .slice()
      .reverse()
      .map(
        (h) => `<div class="hrow">
      <span class="hlabel">${esc(h.label)}</span>
      <div><span class="hdate">${fmtDate(h.createdAt)}</span> ${h.id === cur.id ? '<span class="pill">current</span>' : ""} <span class="count">${[...h.text].length} characters</span>
        <p class="hl-text">${esc(h.text)}</p>${h.note ? `<p class="hint">${esc(h.note)}</p>` : ""}</div>
      <div class="bar"><button class="btn small" data-act="hlcopy" data-id="${esc(h.id)}">Copy ${esc(h.label)}</button>
        ${h.id !== cur.id ? `<button class="btn small" data-act="hlsetcur" data-id="${esc(h.id)}">Make current</button><button class="btn small" data-act="hlcmp" data-id="${esc(h.id)}">Compare with current</button>` : ""}
        <button class="btn small" data-act="hledit" data-id="${esc(h.id)}">Edit from this</button>${delHControl(h.id, cur.id)}</div></div>`,
      )
      .join("")}</div>`;
  let cmp = "";
  if (hs.length > 1) {
    const a = hlById(S.hlCmpA) || hs[hs.length - 2];
    const b = hlById(S.hlCmpB) || cur;
    const opts = (sel: string) => hs.slice().reverse().map((h) => `<option value="${esc(h.id)}"${h.id === sel ? " selected" : ""}>${esc(h.label)} - ${fmtDate(h.createdAt)}</option>`).join("");
    cmp = `<h3 id="hlCompare" class="sec-h">Compare</h3>
      <div class="cmp-pick"><label for="hlA">Older<select class="f" id="hlA">${opts(a.id)}</select></label><label for="hlB">Newer<select class="f" id="hlB">${opts(b.id)}</select></label></div>
      <p class="hint">Removed words are struck through; added words are underlined.</p>
      <div class="card wd">${a.text === b.text ? '<span class="hint">These versions are identical.</span>' : wordDiff(a.text, b.text)}</div>`;
  }
  return head + editor + preview + hist + cmp;
}

/* ---------- settings and backup ---------- */
const listText = (xs: string[]) => xs.join(", ");
function settingsHtml() {
  const s = lib.settings;
  const err = (id: string) => S.settingsErrors.find((e) => e.id === id);
  const field = (id: string, label: string, hint: string, control: string) => {
    const e = err(id);
    return `<div class="field"><label for="${id}" class="field-label">${label}</label>${hint ? `<p class="hint" id="${id}-hint">${hint}</p>` : ""}${control}${e ? `<p class="field-error" id="${id}-err">${esc(e.msg)}</p>` : ""}</div>`;
  };
  const describe = (id: string, hint: boolean) => {
    const ids = [hint ? `${id}-hint` : "", err(id) ? `${id}-err` : ""].filter(Boolean).join(" ");
    return `${ids ? ` aria-describedby="${ids}"` : ""}${err(id) ? ' aria-invalid="true"' : ""}`;
  };
  const typed = (id: string, value: string) => S.settingsDraft?.[id] ?? value;
  const input = (id: string, value: string, hint = true, extra = "") => `<input class="f" id="${id}" value="${esc(typed(id, value))}"${describe(id, hint)}${extra}>`;
  const area = (id: string, value: string, hint = true) => `<textarea class="f" id="${id}" rows="3"${describe(id, hint)}>${esc(typed(id, value))}</textarea>`;
  const dashes = S.settingsDraft ? S.settingsDraft.sDashes === "1" : s.flagDashes;
  const errors = S.settingsErrors.length
    ? `<div class="banner danger" role="alert" id="settingsErrors"><div><p><strong>Please fix ${S.settingsErrors.length === 1 ? "this" : "these"} before saving:</strong></p><ul>${S.settingsErrors.map((e) => `<li><a href="#${e.id}">${esc(e.msg)}</a></li>`).join("")}</ul></div></div>`
    : "";
  const counts = `${lib.versions.length} resume version${lib.versions.length === 1 ? "" : "s"}, ${lib.applications.length} application${lib.applications.length === 1 ? "" : "s"}, ${lib.contacts.length} contact${lib.contacts.length === 1 ? "" : "s"}, ${lib.headlines.length} headline${lib.headlines.length === 1 ? "" : "s"}`;
  return `<div class="work-head"><div><h2>Settings and backup</h2><p class="sub">Your details and the checks run on your resume. These stay in this browser too.</p></div></div>
  <section class="panel" aria-labelledby="backupH">
    <h3 id="backupH" class="sec-h">Backup</h3>
    <p>Your data is saved only in this browser on this device: ${counts}. ${lib.lastBackupAt ? `Last backup: ${fmtDate(lib.lastBackupAt)}.` : "No backup saved yet."}</p>
    <p class="hint">A backup is a file you keep. Use it to move to another computer or browser, or to recover if this browser's data is cleared.</p>
    <div class="bar"><button class="btn primary" data-act="backup"${hasData() ? "" : " disabled"}>Download backup</button>
      <label class="btn file-btn">Restore from a backup file<input type="file" id="restoreFile" accept=".json,application/json" class="sr-only"></label>
      ${hasData() ? "" : `<button class="btn" data-act="sample">Load sample data</button>`}</div>
    ${S.pendingRestore ? `<div class="banner" role="alert"><span>Replace everything here with the backup? The backup has ${S.pendingRestore.versions.length} resume versions, ${S.pendingRestore.applications.length} applications and ${S.pendingRestore.contacts.length} contacts. What's in this browser now will be lost unless you download a backup first.</span><span class="bar"><button class="btn small danger" data-act="restoreyes">Replace with backup</button><button class="btn small" data-act="restoreno">Cancel</button></span></div>` : ""}
  </section>
  <form class="panel settings" id="settingsForm" aria-labelledby="detailsH" novalidate>
    <h3 id="detailsH" class="sec-h">Your details and checks</h3>
    ${errors}
    ${field("sName", "Your name", "Used for the PDF file name and the headline preview.", input("sName", s.name))}
    ${field("sLocation", "Location", "Shown in the headline preview, as on LinkedIn.", input("sLocation", s.location))}
    ${field("sMust", "Must include", "Words every resume version should contain, such as your current employer. Separate with commas.", input("sMust", listText(s.mustInclude)))}
    ${field("sClaims", "Years of experience", "One per line, as you write it on your resume, for example: 12 in product. The check flags any version that says a different number.", area("sClaims", s.experienceClaims.map((c) => `${c.years} in ${c.area}`).join("\n")))}
    ${field("sTeams", "Team sizes", 'The numbers of direct reports on your resume, separated by commas. Any other "N direct reports" gets flagged.', input("sTeams", s.teamSizes.join(", "), true, ' inputmode="numeric"'))}
    ${field("sTone", "Words to avoid", "Separate with commas.", input("sTone", listText(s.toneWords)))}
    <div class="field"><label class="check-lbl"><input type="checkbox" id="sDashes"${dashes ? " checked" : ""}> Flag em and en dashes</label></div>
    ${field("sPay", "Lowest pay you're targeting", "Applications whose posted range tops out below this get a flag. Leave blank to turn this off.", input("sPay", s.payFloor ? String(s.payFloor) : "", true, ' inputmode="numeric" autocomplete="off"'))}
    ${field("sSetups", "Work setups", "The choices in the application form, separated by commas.", input("sSetups", listText(s.workSetups)))}
    ${field("sFlagged", "Work setups to flag", "Any of the setups above that you want a warning for, separated by commas.", input("sFlagged", listText(s.flaggedSetups)))}
    ${field("sRel", "Relationship suggestions", 'Suggestions for "How you know them" on contacts, separated by commas.', input("sRel", listText(s.relationships)))}
    <div class="bar"><button class="btn primary" type="submit">Save settings</button></div>
  </form>
  <section class="panel" aria-labelledby="wipeH">
    <h3 id="wipeH" class="sec-h">Delete everything</h3>
    <p>Removes all your data from this browser. This can't be undone, so download a backup first if you might want it later.</p>
    <div class="bar">${S.confirmWipe ? `<span class="hint">Delete all your data from this browser?</span><button class="btn small danger" data-act="wipeyes">Delete everything</button><button class="btn small" data-act="wipeno">Cancel</button>` : `<button class="btn danger" data-act="wipe"${hasData() ? "" : " disabled"}>Delete everything</button>`}</div>
  </section>`;
}

function readSettings(form: HTMLFormElement): { settings: Settings; errors: { id: string; msg: string }[] } {
  const g = (id: string) => (form.querySelector<HTMLInputElement>("#" + id)?.value || "").trim();
  const list = (id: string) => [...new Set(g(id).split(/[,\n]/).map((x) => x.trim()).filter(Boolean))];
  const errors: { id: string; msg: string }[] = [];
  const claims = g("sClaims")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(\d+)\s*\+?\s*(?:years?\s+)?(?:of\s+)?(?:experience\s+)?in\s+(.+)$/i);
      if (!m) errors.push({ id: "sClaims", msg: `Years of experience: write "${line}" like "12 in product".` });
      return m ? { years: Number(m[1]), area: m[2].trim() } : null;
    })
    .filter((c): c is { years: number; area: string } => !!c);
  const teamRaw = list("sTeams");
  const teams = teamRaw.map(Number);
  if (teams.some((n) => !Number.isInteger(n) || n <= 0)) errors.push({ id: "sTeams", msg: "Team sizes: use whole numbers, such as 3, 5." });
  const payRaw = g("sPay").replace(/[$,\s]/g, "");
  let pay = 0;
  if (payRaw) {
    const m = payRaw.match(/^(\d+(?:\.\d+)?)([kK])?$/);
    if (!m) errors.push({ id: "sPay", msg: "Lowest pay: enter an amount such as 150000 or 150K." });
    else pay = Math.round(parseFloat(m[1]) * (m[2] || parseFloat(m[1]) < 1000 ? 1000 : 1));
  }
  const setups = list("sSetups");
  if (!setups.length) errors.push({ id: "sSetups", msg: "Work setups: add at least one, such as Remote." });
  return {
    settings: {
      name: g("sName"),
      location: g("sLocation"),
      mustInclude: list("sMust"),
      experienceClaims: claims,
      teamSizes: teams.filter((n) => Number.isInteger(n) && n > 0),
      toneWords: list("sTone"),
      flagDashes: !!form.querySelector<HTMLInputElement>("#sDashes")?.checked,
      pageLimit: lib.settings.pageLimit,
      payFloor: pay,
      workSetups: setups,
      flaggedSetups: list("sFlagged"),
      relationships: list("sRel"),
    },
    errors,
  };
}

/* ---------- render ---------- */
/** Remembers which control had focus, so keyboard users don't lose their place when the page redraws. */
function focusKey(el: Element | null): string | null {
  if (!(el instanceof HTMLElement) || !$("#app")?.contains(el)) return null;
  if (el.id) return "#" + CSS.escape(el.id);
  const parts = ["section", "tab", "filter", "act", "id", "sid"].filter((k) => el.dataset[k] !== undefined).map((k) => `[data-${k}="${CSS.escape(el.dataset[k]!)}"]`);
  return parts.length ? parts.join("") : null;
}

function render(focusTarget?: string) {
  const key = focusTarget || focusKey(document.activeElement);
  renderNav();
  $("#banners")!.innerHTML = bannersHtml();
  const html = { resume: resumeHtml, apps: appsHtml, contacts: contactsHtml, headline: headlineHtml, settings: settingsHtml }[S.section]();
  $("#work")!.innerHTML = html;
  $("#work h2")?.setAttribute("tabindex", "-1");
  if (key) {
    const el = document.querySelector<HTMLElement>(key);
    if (el) el.focus({ preventScroll: true });
    else if (focusTarget === undefined && !document.activeElement?.closest("#app")) $("#work h2")?.focus();
  }
}

/** Moves focus to the section heading after switching sections, the way a new page would. */
function goTo(section: Section) {
  S.section = section;
  S.settingsDraft = null;
  S.settingsErrors = [];
  pref.set("section", section);
  history.replaceState(null, "", "#" + section);
  render("#work h2");
}

/* ---------- actions ---------- */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    announce("Copied.");
  } catch {
    announce("Copying didn't work in this browser. Select the text and copy it instead.");
  }
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadBackup() {
  const now = new Date();
  download(new Blob([exportBackup(lib, now)], { type: "application/json" }), backupFilename(now));
  commit((l) => (l.lastBackupAt = now.toISOString()), `Backup downloaded as ${backupFilename(now)}. Keep it somewhere safe, such as a cloud drive.`);
}

async function downloadPdf(btn: HTMLButtonElement, vid: string) {
  const v = vById(vid);
  if (!v) return;
  btn.disabled = true;
  announce("Building PDF...");
  const limit = lib.settings.pageLimit;
  try {
    const { makeResumePdf } = await import("../lib/pdf");
    const res = await makeResumePdf(v.content, limit, BASE);
    const name = (lib.settings.name || "Resume").replace(/[\\/:*?"<>|]/g, "");
    download(res.blob, `${name} Resume ${v.label.replace(/[\\/:*?"<>|]/g, "")}.pdf`);
    announce(
      res.fit
        ? `PDF downloaded (${pages(res.pages)}).`
        : `Too long for ${pages(limit)} at a readable size, so the PDF is ${pages(res.pages)}. Trim a bullet or two, or raise the page limit, and try again.`,
    );
  } catch (err) {
    announce("Couldn't build the PDF: " + (err as Error).message);
  } finally {
    btn.disabled = false;
  }
}

function saveVersion() {
  const content = $<HTMLTextAreaElement>("#ed")!.value;
  if (!content.trim()) return announce("Paste your resume first.");
  const label = $<HTMLInputElement>("#vLabel")!.value.trim();
  const note = $<HTMLInputElement>("#vNote")!.value.trim();
  const app = lib.applications.find((a) => a.id === $<HTMLSelectElement>("#vApp")!.value);
  const cur = current();
  if (cur && cur.content === content) return announce(`No changes since ${cur.label}.`);
  const n = (versions().slice(-1)[0]?.n || 0) + 1;
  const id = newId();
  const now = new Date().toISOString();
  const name = label || "v" + n;
  const ok = commit(
    (l) => {
      l.versions.push({ id, n, label: name, note: note || (app ? `Tailored for ${app.company}` : ""), content, createdAt: now });
      l.currentVersion = id;
      const a = app && l.applications.find((x) => x.id === app.id);
      if (a) Object.assign(a, { versionId: id, updatedAt: now });
    },
    `Saved ${name} as your current version${app ? ` and linked it to ${app.company}` : ""}.`,
  );
  if (ok) {
    pref.del(DRAFT);
    S.view = null;
    S.tab = "preview";
    pref.set("tab", "preview");
    render(".tab[data-tab=preview]");
  }
}

function saveApp(form: HTMLFormElement) {
  const g = (id: string) => (form.querySelector<HTMLInputElement>("#" + id)?.value || "").trim();
  const now = new Date().toISOString();
  const data = {
    company: g("fCompany"),
    role: g("fRole"),
    status: g("fStatus") as Application["status"],
    appliedOn: g("fApplied"),
    versionId: g("fVersion"),
    setup: g("fSetup"),
    base: g("fBase"),
    bonus: g("fBonus"),
    nextStep: g("fNext"),
    nextDate: g("fNextDate"),
    contact: g("fContact"),
    url: g("fUrl"),
    notes: g("fNotes"),
    updatedAt: now,
  };
  const missing = !data.company ? "fCompany" : !data.role ? "fRole" : null;
  if (missing) {
    const el = form.querySelector<HTMLInputElement>("#" + missing)!;
    el.setAttribute("aria-invalid", "true");
    el.focus();
    return announce(`Add a ${missing === "fCompany" ? "company" : "role"} first.`);
  }
  const id = form.dataset.id!;
  const isNew = id === "new";
  const newAppId = newId();
  const ok = commit((l) => {
    if (isNew) l.applications.push({ ...data, id: newAppId, createdAt: now });
    else Object.assign(l.applications.find((a) => a.id === id)!, data);
  }, `${isNew ? "Added" : "Saved"} ${data.company}.`);
  if (ok) {
    S.editing = null;
    render(`[data-act="editapp"][data-id="${CSS.escape(isNew ? newAppId : id)}"]`);
  }
}

function saveContact(form: HTMLFormElement) {
  const g = (id: string) => (form.querySelector<HTMLInputElement>("#" + id)?.value || "").trim();
  const now = new Date().toISOString();
  const data = { name: g("cName"), company: g("cCompany"), title: g("cTitle"), relationship: g("cRel"), reach: g("cReach"), followUp: g("cFollow"), notes: g("cNotes"), updatedAt: now };
  if (!data.name) {
    const el = form.querySelector<HTMLInputElement>("#cName")!;
    el.setAttribute("aria-invalid", "true");
    el.focus();
    return announce("Add a name first.");
  }
  const id = form.dataset.id!;
  const isNew = id === "new";
  const cid = newId();
  const vid = g("cVersion");
  const ok = commit((l) => {
    if (isNew) l.contacts.push({ ...data, id: cid, createdAt: now, shares: vid ? [{ id: newId(), versionId: vid, date: g("cDate") || today(), note: "" }] : [] });
    else Object.assign(l.contacts.find((c) => c.id === id)!, data);
  }, isNew ? `Added ${data.name}${vid ? ` with ${vById(vid)?.label} shared` : ""}.` : `Saved ${data.name}.`);
  if (ok) {
    S.editingC = null;
    render(`[data-act="editc"][data-id="${CSS.escape(isNew ? cid : id)}"]`);
  }
}

function logShare(form: HTMLFormElement) {
  const cid = form.dataset.id!;
  const c = lib.contacts.find((x) => x.id === cid);
  const versionId = form.querySelector<HTMLSelectElement>("#sVersion")!.value;
  if (!c || !versionId) return announce("Save a resume version first.");
  const entry = { id: newId(), versionId, date: form.querySelector<HTMLInputElement>("#sDate")!.value || today(), note: form.querySelector<HTMLInputElement>("#sNote")!.value.trim() };
  const ok = commit((l) => {
    const x = l.contacts.find((y) => y.id === cid)!;
    x.shares.push(entry);
    x.updatedAt = new Date().toISOString();
  }, `Logged ${vById(versionId)?.label} shared with ${c.name}.`);
  if (ok) {
    S.shareFor = null;
    render(`[data-act="shareto"][data-id="${CSS.escape(cid)}"]`);
  }
}

function saveHeadline() {
  const text = ($<HTMLTextAreaElement>("#hlEd")!.value || "").trim().replace(/\s+/g, " ");
  if (!text) return announce("Add the headline text first.");
  const cur = curHeadline();
  if (cur && cur.text === text) return announce(`Same as ${cur.label}.`);
  const n = (hlSorted().slice(-1)[0]?.n || 0) + 1;
  const label = $<HTMLInputElement>("#hlLabel")!.value.trim() || "v" + n;
  const note = $<HTMLInputElement>("#hlNote")!.value.trim();
  const id = newId();
  const ok = commit(
    (l) => {
      l.headlines.push({ id, n, label, text, note, createdAt: new Date().toISOString() });
      l.currentHeadline = id;
    },
    `Saved ${label} as your current headline.`,
  );
  if (ok) {
    pref.del(HL_DRAFT);
    S.hlEditing = false;
    render('[data-act="hlnew"]');
  }
}

function handleAction(el: HTMLElement) {
  const id = el.dataset.id || "";
  const a = el.dataset.act;
  switch (a) {
    case "view":
      S.view = id;
      S.tab = "preview";
      return render(".tab[data-tab=preview]");
    case "viewver":
      S.view = id === current()?.id ? null : id;
      S.tab = "preview";
      S.section = "resume";
      pref.set("section", "resume");
      return render("#work h2");
    case "viewcur":
      S.view = null;
      return render(".tab[data-tab=preview]");
    case "setcur": {
      const v = vById(id);
      if (v) commit((l) => (l.currentVersion = id), `${v.label} is now your current version.`);
      S.view = null;
      return render(".tab[aria-current]");
    }
    case "askdelv":
      S.delV = id;
      return render(`[data-act="delv"][data-id="${CSS.escape(id)}"]`);
    case "nodelv":
      S.delV = null;
      return render(`[data-act="askdelv"][data-id="${CSS.escape(id)}"]`);
    case "delv": {
      const v = vById(id);
      if (!v || id === current()?.id) return;
      S.delV = null;
      if (S.view === id) S.view = null;
      commit((l) => (l.versions = l.versions.filter((x) => x.id !== id)), `Deleted ${v.label}.`);
      return render(".tab[aria-current]");
    }
    case "cmpcur":
      S.cmpA = id;
      S.cmpB = current()?.id || null;
      S.tab = "compare";
      return render(".tab[data-tab=compare]");
    case "toedit": {
      const v = vById(id);
      if (!v) return;
      pref.set(DRAFT, v.content);
      S.tab = "edit";
      return render("#ed");
    }
    case "discard":
      pref.del(DRAFT);
      return render("#ed");
    case "savev":
      return saveVersion();
    case "copy": {
      const v = vById(id);
      if (v) copyText(plain(v.content));
      return;
    }
    case "pdf":
      return void downloadPdf(el as HTMLButtonElement, id);
    case "openapp":
      S.section = "apps";
      S.filter = "All";
      S.editing = id;
      render("#fCompany");
      $("#app-" + CSS.escape(id))?.scrollIntoView({ block: "start" });
      return;
    case "newapp":
      S.editing = "new";
      S.confirmDel = null;
      return render("#fCompany");
    case "editapp":
      S.editing = S.editing === id ? null : id;
      S.confirmDel = null;
      return render(S.editing ? "#fCompany" : undefined);
    case "cancelapp": {
      const was = S.editing;
      S.editing = null;
      S.confirmDel = null;
      return render(was && was !== "new" ? `[data-act="editapp"][data-id="${CSS.escape(was)}"]` : '[data-act="newapp"]');
    }
    case "askdel":
      S.confirmDel = id;
      return render(`[data-act="delapp"][data-id="${CSS.escape(id)}"]`);
    case "nodel":
      S.confirmDel = null;
      return render(`[data-act="askdel"][data-id="${CSS.escape(id)}"]`);
    case "delapp": {
      const app = lib.applications.find((x) => x.id === id);
      S.editing = null;
      S.confirmDel = null;
      commit((l) => (l.applications = l.applications.filter((x) => x.id !== id)), `Deleted ${app?.company || "the application"}.`);
      return render('[data-act="newapp"]');
    }
    case "opencontact":
      S.section = "contacts";
      S.cFilter = "";
      S.editingC = null;
      render(`[data-act="editc"][data-id="${CSS.escape(id)}"]`);
      $("#contact-" + CSS.escape(id))?.scrollIntoView({ block: "start" });
      return;
    case "newc":
      S.editingC = "new";
      S.shareFor = null;
      S.confirmDelC = null;
      return render("#cName");
    case "editc":
      S.editingC = S.editingC === id ? null : id;
      S.shareFor = null;
      S.confirmDelC = null;
      return render(S.editingC ? "#cName" : undefined);
    case "cancelc": {
      const was = S.editingC;
      S.editingC = null;
      S.confirmDelC = null;
      return render(was && was !== "new" ? `[data-act="editc"][data-id="${CSS.escape(was)}"]` : '[data-act="newc"]');
    }
    case "shareto":
      if (!versions().length) return announce("Save a resume version first, then you can log who you shared it with.");
      S.shareFor = S.shareFor === id ? null : id;
      S.editingC = null;
      return render(S.shareFor ? "#sVersion" : undefined);
    case "cancelshare": {
      const was = S.shareFor;
      S.shareFor = null;
      return render(was ? `[data-act="shareto"][data-id="${CSS.escape(was)}"]` : undefined);
    }
    case "rmshare": {
      const sid = el.dataset.sid;
      commit((l) => {
        const c = l.contacts.find((x) => x.id === id);
        if (c) c.shares = c.shares.filter((s) => s.id !== sid);
      }, "Share removed.");
      return render(`[data-act="shareto"][data-id="${CSS.escape(id)}"]`);
    }
    case "askdelc":
      S.confirmDelC = id;
      return render(`[data-act="delc"][data-id="${CSS.escape(id)}"]`);
    case "nodelc":
      S.confirmDelC = null;
      return render(`[data-act="askdelc"][data-id="${CSS.escape(id)}"]`);
    case "delc": {
      const c = lib.contacts.find((x) => x.id === id);
      S.editingC = null;
      S.confirmDelC = null;
      commit((l) => (l.contacts = l.contacts.filter((x) => x.id !== id)), `Deleted ${c?.name || "the contact"}.`);
      return render('[data-act="newc"]');
    }
    case "hlnew":
      S.hlEditing = !S.hlEditing;
      return render(S.hlEditing ? "#hlEd" : '[data-act="hlnew"]');
    case "hledit": {
      const h = hlById(id);
      if (!h) return;
      pref.set(HL_DRAFT, h.text);
      S.hlEditing = true;
      render("#hlEd");
      scrollTo(0, 0);
      return;
    }
    case "hlsave":
      return saveHeadline();
    case "hlsetcur": {
      const h = hlById(id);
      if (h) commit((l) => (l.currentHeadline = id), `${h.label} is now your current headline.`);
      return render('[data-act="hlcopy"]');
    }
    case "hlcmp":
      S.hlCmpA = id;
      S.hlCmpB = curHeadline()?.id || null;
      render("#hlA");
      $("#hlCompare")?.scrollIntoView({ block: "start" });
      return;
    case "hlcopy": {
      const h = hlById(id);
      if (h) copyText(h.text);
      return;
    }
    case "askdelh":
      S.delH = id;
      return render(`[data-act="delh"][data-id="${CSS.escape(id)}"]`);
    case "nodelh":
      S.delH = null;
      return render(`[data-act="askdelh"][data-id="${CSS.escape(id)}"]`);
    case "delh": {
      const h = hlById(id);
      if (!h || id === curHeadline()?.id) return;
      S.delH = null;
      commit((l) => (l.headlines = l.headlines.filter((x) => x.id !== id)), `Deleted headline ${h.label}.`);
      return render('[data-act="hlnew"]');
    }
    case "backup":
      return downloadBackup();
    case "rawcopy":
      if (loaded.raw) download(new Blob([loaded.raw], { type: "application/json" }), "job-search-unreadable-data.json");
      return;
    case "sample":
      if (hasData()) return;
      commit((l) => Object.assign(l, sampleLibrary()), "Loaded sample data for a made-up job seeker. Delete it in Settings when you're ready to add your own.");
      S.tab = "preview";
      return goTo("resume");
    case "restoreyes":
      if (!S.pendingRestore) return;
      commit((l) => Object.assign(l, emptyLibrary(), S.pendingRestore), "Backup restored.");
      S.pendingRestore = null;
      S.loadError = null;
      return render('[data-act="backup"]');
    case "restoreno":
      S.pendingRestore = null;
      announce("Restore cancelled. Nothing changed.");
      return render("#restoreFile");
    case "wipe":
      S.confirmWipe = true;
      return render('[data-act="wipeyes"]');
    case "wipeno":
      S.confirmWipe = false;
      return render('[data-act="wipe"]');
    case "wipeyes":
      S.confirmWipe = false;
      S.loadError = null;
      commit((l) => Object.assign(l, emptyLibrary()), "All your data was deleted from this browser.");
      pref.del(DRAFT);
      pref.del(HL_DRAFT);
      return render("#work h2");
  }
}

/* ---------- events ---------- */
document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const sec = t.closest<HTMLElement>("[data-section]");
  if (sec) return goTo(sec.dataset.section as Section);
  const tab = t.closest<HTMLElement>("[data-tab]");
  if (tab) {
    S.tab = tab.dataset.tab as ResumeTab;
    pref.set("tab", S.tab);
    if (S.tab !== "preview") S.view = null;
    if (S.section !== "resume") S.section = "resume";
    return render(S.tab === "edit" && !current() ? "#ed" : `.tab[data-tab="${S.tab}"]`);
  }
  const fl = t.closest<HTMLElement>("[data-filter]");
  if (fl) {
    S.filter = fl.dataset.filter!;
    pref.set("filter", S.filter);
    return render();
  }
  const act = t.closest<HTMLElement>("[data-act]");
  if (act && !(act as HTMLButtonElement).disabled) handleAction(act);
});

document.addEventListener("submit", (e) => {
  const form = e.target as HTMLFormElement;
  e.preventDefault();
  if (form.id === "appForm") saveApp(form);
  else if (form.id === "contactForm") saveContact(form);
  else if (form.id === "shareForm") logShare(form);
  else if (form.id === "settingsForm") {
    const { settings, errors } = readSettings(form);
    S.settingsErrors = errors;
    S.settingsDraft = errors.length
      ? Object.fromEntries([...form.querySelectorAll<HTMLInputElement>("input, textarea")].map((el) => [el.id, el.type === "checkbox" ? (el.checked ? "1" : "0") : el.value]))
      : null;
    if (errors.length) {
      render("#settingsErrors");
      $("#settingsErrors")?.setAttribute("tabindex", "-1");
      $("#settingsErrors")?.focus();
      return;
    }
    commit((l) => (l.settings = settings), "Settings saved.");
  }
});

document.addEventListener("change", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === "pageLimit") {
    const n = Number(t.value);
    commit((l) => (l.settings.pageLimit = n), n ? `PDFs will fit within ${pages(n)}.` : "PDFs will use as many pages as the resume needs.");
  }
  if (t.id === "hlA" || t.id === "hlB") {
    S.hlCmpA = $<HTMLSelectElement>("#hlA")!.value;
    S.hlCmpB = $<HTMLSelectElement>("#hlB")!.value;
    render();
  }
  if (t.id === "cmpA" || t.id === "cmpB") {
    S.cmpA = $<HTMLSelectElement>("#cmpA")!.value;
    S.cmpB = $<HTMLSelectElement>("#cmpB")!.value;
    render();
  }
  if (t.id === "restoreFile" && t.files?.[0]) {
    t.files[0]
      .text()
      .then((text) => {
        const restored = parseBackup(text);
        if (!hasData() && !S.loadError) {
          commit((l) => Object.assign(l, restored), "Backup restored.");
          return;
        }
        S.pendingRestore = restored;
        render('[data-act="restoreyes"]');
      })
      .catch((err: Error) => announce(err.message));
    t.value = "";
  }
});

let sideTimer: number | undefined;
document.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.getAttribute("aria-invalid") === "true" && t.value.trim() && t.closest("#appForm, #contactForm")) t.removeAttribute("aria-invalid");
  if (t.id === "hlEd") {
    pref.set(HL_DRAFT, t.value);
    const len = [...t.value.trim()].length;
    const c = $("#hlCount");
    if (c) {
      c.textContent = `${len} of ${HEADLINE_MAX} characters`;
      c.classList.toggle("over", len > HEADLINE_MAX);
    }
    const side = $("#hlSide");
    if (side) side.innerHTML = checksCard(hlChecks(t.value.trim()));
    return;
  }
  if (t.id === "cSearch") {
    S.cFilter = t.value;
    const pos = t.selectionStart;
    render("#cSearch");
    $<HTMLInputElement>("#cSearch")?.setSelectionRange(pos, pos);
    return;
  }
  if (t.id === "ed") {
    pref.set(DRAFT, t.value);
    window.clearTimeout(sideTimer);
    sideTimer = window.setTimeout(() => {
      const side = $("#liveSide");
      if (side) side.innerHTML = sideHtml(t.value);
    }, 250);
  }
});

// Links such as #apps switch sections, and the browser's back button works.
window.addEventListener("hashchange", () => {
  const s = location.hash.replace("#", "") as Section;
  if (SECTIONS.includes(s) && s !== S.section) goTo(s);
});

// If the app is open in two tabs, keep them in step.
window.addEventListener("storage", (e) => {
  if (e.key !== STORAGE_KEY) return;
  const next = loadLibrary(store);
  if (!next.error) {
    lib = next.library;
    render();
  }
});

render();
