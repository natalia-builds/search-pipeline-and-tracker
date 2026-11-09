// Saving and loading. Everything is kept in this browser's localStorage under one key, and nothing
// is ever sent to a server. Backups are plain JSON files the person downloads and keeps.
import { defaultSettings, emptyLibrary, SCHEMA_VERSION, STATUSES, type Library, type Settings } from "./types";

export const STORAGE_KEY = "spt.library";
const BACKUP_APP = "search-pipeline-and-tracker";

/** The two localStorage methods we use, so tests can pass in a stand-in. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type Raw = Record<string, unknown>;
const isObj = (x: unknown): x is Raw => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown) => (typeof x === "string" ? x : "");
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const strList = (x: unknown) => arr(x).filter((v): v is string => typeof v === "string");

function normalizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!isObj(raw)) return d;
  return {
    name: str(raw.name),
    location: str(raw.location),
    mustInclude: Array.isArray(raw.mustInclude) ? strList(raw.mustInclude) : d.mustInclude,
    experienceClaims: arr(raw.experienceClaims)
      .filter(isObj)
      .map((c) => ({ area: str(c.area), years: Number(c.years) || 0 })),
    teamSizes: arr(raw.teamSizes).map(Number).filter((n) => Number.isInteger(n) && n > 0),
    toneWords: Array.isArray(raw.toneWords) ? strList(raw.toneWords) : d.toneWords,
    flagDashes: typeof raw.flagDashes === "boolean" ? raw.flagDashes : d.flagDashes,
    payFloor: Math.max(0, Number(raw.payFloor) || 0),
    workSetups: Array.isArray(raw.workSetups) && raw.workSetups.length ? strList(raw.workSetups) : d.workSetups,
    flaggedSetups: Array.isArray(raw.flaggedSetups) ? strList(raw.flaggedSetups) : d.flaggedSetups,
    relationships: Array.isArray(raw.relationships) ? strList(raw.relationships) : d.relationships,
  };
}

/** Fills in anything missing and drops anything malformed, so older or hand-edited data still loads. */
export function normalize(raw: unknown): Library {
  if (!isObj(raw)) throw new Error("This isn't a tracker library.");
  if (typeof raw.schema === "number" && raw.schema > SCHEMA_VERSION)
    throw new Error("This backup was made by a newer version of the app. Reload the page to get the latest version, then try again.");
  const withId = (x: unknown): x is Raw => isObj(x) && typeof x.id === "string" && x.id !== "";
  const lib = emptyLibrary();
  lib.settings = normalizeSettings(raw.settings);
  lib.versions = arr(raw.versions)
    .filter(withId)
    .map((v) => ({ id: v.id as string, n: Number(v.n) || 0, label: str(v.label), note: str(v.note), content: str(v.content), createdAt: str(v.createdAt) }));
  lib.applications = arr(raw.applications)
    .filter(withId)
    .map((a) => ({
      id: a.id as string,
      company: str(a.company),
      role: str(a.role),
      status: (STATUSES as readonly string[]).includes(str(a.status)) ? (a.status as Library["applications"][number]["status"]) : "Applied",
      appliedOn: str(a.appliedOn),
      versionId: str(a.versionId),
      setup: str(a.setup),
      base: str(a.base),
      bonus: str(a.bonus) || "Unknown",
      nextStep: str(a.nextStep),
      nextDate: str(a.nextDate),
      contact: str(a.contact),
      url: str(a.url),
      notes: str(a.notes),
      createdAt: str(a.createdAt),
      updatedAt: str(a.updatedAt),
    }));
  lib.contacts = arr(raw.contacts)
    .filter(withId)
    .map((c) => ({
      id: c.id as string,
      name: str(c.name),
      company: str(c.company),
      title: str(c.title),
      relationship: str(c.relationship),
      reach: str(c.reach),
      followUp: str(c.followUp),
      notes: str(c.notes),
      shares: arr(c.shares)
        .filter(withId)
        .map((s) => ({ id: s.id as string, versionId: str(s.versionId), date: str(s.date), note: str(s.note) })),
      createdAt: str(c.createdAt),
      updatedAt: str(c.updatedAt),
    }));
  lib.headlines = arr(raw.headlines)
    .filter(withId)
    .map((h) => ({ id: h.id as string, n: Number(h.n) || 0, label: str(h.label), text: str(h.text), note: str(h.note), createdAt: str(h.createdAt) }));
  const cv = str(raw.currentVersion);
  lib.currentVersion = lib.versions.some((v) => v.id === cv) ? cv : null;
  const ch = str(raw.currentHeadline);
  lib.currentHeadline = lib.headlines.some((h) => h.id === ch) ? ch : null;
  lib.lastBackupAt = str(raw.lastBackupAt) || null;
  return lib;
}

export interface LoadResult {
  library: Library;
  /** Set when saved data existed but could not be read. The raw text is kept so nothing is lost. */
  error: string | null;
  raw: string | null;
}

export function loadLibrary(store: KeyValueStore | null): LoadResult {
  let raw: string | null = null;
  try {
    raw = store ? store.getItem(STORAGE_KEY) : null;
  } catch {
    return { library: emptyLibrary(), error: "This browser is blocking saved data, so nothing you enter will be kept.", raw: null };
  }
  if (!raw) return { library: emptyLibrary(), error: null, raw: null };
  try {
    return { library: normalize(JSON.parse(raw)), error: null, raw };
  } catch (e) {
    return { library: emptyLibrary(), error: `Your saved data couldn't be read (${(e as Error).message}).`, raw };
  }
}

/** Returns an error message, or null when the save worked. */
export function saveLibrary(store: KeyValueStore | null, lib: Library): string | null {
  if (!store) return "This browser is blocking saved data.";
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(lib));
    return null;
  } catch (e) {
    const full = e instanceof DOMException && (e.name === "QuotaExceededError" || e.code === 22);
    return full ? "This browser's storage is full, so the last change wasn't saved." : "The last change couldn't be saved in this browser.";
  }
}

export function exportBackup(lib: Library, now = new Date()): string {
  return JSON.stringify({ app: BACKUP_APP, exportedAt: now.toISOString(), ...lib }, null, 2);
}

export function parseBackup(text: string): Library {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a backup from this app. Choose the .json file you saved with Download backup.");
  }
  if (!isObj(data) || data.app !== BACKUP_APP) throw new Error("That file isn't a backup from this app. Choose the .json file you saved with Download backup.");
  return normalize(data);
}

export const backupFilename = (now = new Date()) => `job-search-backup-${now.toISOString().slice(0, 10)}.json`;
