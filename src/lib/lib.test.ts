import { describe, expect, it } from "vitest";
import { applicationFlags, headlineChecks, resumeChecks, topOfRange } from "./checks";
import { lineDiff, wordDiff } from "./diff";
import { boldedMetrics, esc, plain, renderMarkdown, wordCount } from "./markdown";
import { sampleLibrary } from "./sample";
import { exportBackup, loadLibrary, normalize, parseBackup, saveLibrary, STORAGE_KEY, type KeyValueStore } from "./storage";
import { defaultSettings, emptyLibrary, type Application, type Settings } from "./types";

const settings = (over: Partial<Settings> = {}): Settings => ({ ...defaultSettings(), ...over });
const memoryStore = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe("markdown", () => {
  it("escapes HTML so pasted text can't run code", () => {
    expect(renderMarkdown("# Name\n<script>alert(1)</script>")).not.toContain("<script>");
    expect(esc(`<a href="x">`)).toBe("&lt;a href=&quot;x&quot;&gt;");
  });
  it("renders the name, headings, bullets and bold", () => {
    const html = renderMarkdown("# Pat Lee\n## Experience\n### Acme\n* Grew revenue **40%**");
    expect(html).toContain('<p class="name">Pat Lee</p>');
    expect(html).toContain('<h3 class="sec">Experience</h3>');
    expect(html).toContain('<h4 class="co">Acme</h4>');
    expect(html).toContain("<li>Grew revenue <strong>40%</strong></li>");
  });
  it("makes plain text without Markdown marks", () => {
    expect(plain("## Skills\n* **SQL**, [site](https://x.com)\nTitle\t2020")).toBe("Skills\n- SQL, site\nTitle  |  2020");
  });
  it("counts words and finds bolded numbers", () => {
    expect(wordCount("* one **two** three")).toBe(4);
    expect(boldedMetrics("**40%** and **$2M** and **Leadership**")).toEqual(["40%", "$2M"]);
  });
});

describe("diff", () => {
  it("counts added and removed lines and says nothing for identical text", () => {
    const d = lineDiff("a\nb\nc", "a\nB\nc");
    expect(d.add).toBe(1);
    expect(d.del).toBe(1);
    expect(lineDiff("same", "same").html).toBe("");
  });
  it("marks word changes", () => {
    expect(wordDiff("Senior PM", "Lead PM")).toBe("<del>Senior</del><ins>Lead</ins> PM");
  });
});

describe("resume checks", () => {
  it("runs no personal checks when settings are empty", () => {
    const res = resumeChecks("8 years in product", settings({ toneWords: [], flagDashes: false }));
    expect(res).toEqual([]);
  });
  it("flags dashes, missing phrases and tone words", () => {
    const res = resumeChecks("I am passionate — truly", settings({ mustInclude: ["Acme"] }));
    expect(res.map((r) => r.level)).toEqual(["fail", "fail", "warn"]);
  });
  it("checks experience years against settings, matching the longest area first", () => {
    const s = settings({ experienceClaims: [{ area: "product", years: 12 }, { area: "product leadership", years: 8 }] });
    expect(resumeChecks("12+ years in product and 8+ years in product leadership", s).at(-1)?.level).toBe("ok");
    const bad = resumeChecks("10+ years in product leadership", s).at(-1)!;
    expect(bad.level).toBe("fail");
    expect(bad.text).toContain("10 in product leadership (yours: 8)");
  });
  it("flags team sizes that aren't in settings", () => {
    expect(resumeChecks("Led 6 direct reports", settings({ teamSizes: [3, 5] })).at(-1)?.level).toBe("warn");
    expect(resumeChecks("Led 5 direct reports", settings({ teamSizes: [3, 5] })).at(-1)?.level).toBe("ok");
  });
  it("treats regex characters in settings as plain text", () => {
    expect(() => resumeChecks("C++ dev", settings({ mustInclude: ["C++"], toneWords: ["a.b"] }))).not.toThrow();
  });
});

describe("headline checks", () => {
  it("counts characters against LinkedIn's limit", () => {
    expect(headlineChecks("x".repeat(221), settings(), null)[0].level).toBe("fail");
    expect(headlineChecks("x".repeat(220), settings(), null)[0].level).toBe("ok");
  });
  it("warns when a figure isn't on the current resume", () => {
    const res = headlineChecks("Cut costs 31%", settings(), { label: "v2", content: "* Cut costs **30%**" });
    expect(res.some((r) => r.level === "warn" && r.text.includes("31%"))).toBe(true);
  });
});

describe("application flags", () => {
  const app = (over: Partial<Application>): Application => ({
    id: "a", company: "X", role: "PM", status: "Applied", appliedOn: "", versionId: "", setup: "Remote", base: "$150K - $180K",
    bonus: "Unknown", nextStep: "", nextDate: "", contact: "", url: "", notes: "", createdAt: "", updatedAt: "", ...over,
  });
  it("reads the top of a pay range", () => {
    expect(topOfRange("$150K - $180K")).toBe(180000);
    expect(topOfRange("150,000-175,000")).toBe(175000);
    expect(topOfRange("competitive")).toBeNull();
  });
  it("only flags low pay when a floor is set", () => {
    expect(applicationFlags(app({}), settings(), "2026-01-01")).toEqual([]);
    expect(applicationFlags(app({}), settings({ payFloor: 200000 }), "2026-01-01")).toEqual(["Pay tops out under $200K"]);
  });
  it("flags overdue next steps, but not for closed roles", () => {
    expect(applicationFlags(app({ nextDate: "2025-12-31" }), settings(), "2026-01-01")).toContain("Next step overdue");
    expect(applicationFlags(app({ nextDate: "2025-12-31", status: "Closed" }), settings(), "2026-01-01")).toEqual([]);
  });
});

describe("storage and backups", () => {
  it("starts empty when nothing is saved", () => {
    const r = loadLibrary(memoryStore());
    expect(r.error).toBeNull();
    expect(r.library).toEqual(emptyLibrary());
  });
  it("saves and loads the same library", () => {
    const store = memoryStore();
    const lib = sampleLibrary(new Date("2026-03-01T12:00:00Z"));
    expect(saveLibrary(store, lib)).toBeNull();
    expect(loadLibrary(store).library).toEqual(lib);
  });
  it("keeps the raw text and reports an error when saved data is broken", () => {
    const store = memoryStore();
    store.setItem(STORAGE_KEY, "{not json");
    const r = loadLibrary(store);
    expect(r.error).toMatch(/couldn't be read/);
    expect(r.raw).toBe("{not json");
  });
  it("reports a full browser instead of crashing", () => {
    const full: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    };
    expect(saveLibrary(full, emptyLibrary())).toMatch(/storage is full/);
  });
  it("round-trips a backup file", () => {
    const lib = sampleLibrary(new Date("2026-03-01T12:00:00Z"));
    expect(parseBackup(exportBackup(lib))).toEqual(lib);
  });
  it("rejects files that aren't backups", () => {
    expect(() => parseBackup("hello")).toThrow(/isn't a backup/);
    expect(() => parseBackup(JSON.stringify({ versions: [] }))).toThrow(/isn't a backup/);
  });
  it("rejects backups from a newer version of the app", () => {
    expect(() => parseBackup(JSON.stringify({ app: "search-pipeline-and-tracker", schema: 99 }))).toThrow(/newer version/);
  });
  it("fills in missing fields and drops broken entries", () => {
    const lib = normalize({ versions: [{ id: "v1", content: "x" }, { content: "no id" }, "junk"], currentVersion: "gone", settings: { payFloor: "abc" } });
    expect(lib.versions).toHaveLength(1);
    expect(lib.versions[0].label).toBe("");
    expect(lib.currentVersion).toBeNull();
    expect(lib.settings.payFloor).toBe(0);
    expect(lib.settings.toneWords).toEqual(defaultSettings().toneWords);
  });
});
