// The checks shown beside the resume and headline. Every rule comes from the person's own settings,
// so the app has nothing personal built in.
import { plain } from "./markdown";
import type { Application, Settings } from "./types";

export type Level = "ok" | "warn" | "fail";
export interface Check {
  level: Level;
  text: string;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const DASHES = /[—–]/g;

function toneCheck(text: string, words: string[], verb: string): Check | null {
  const list = words.map((w) => w.trim()).filter(Boolean);
  if (!list.length) return null;
  const re = new RegExp(`\\b(${list.map(escapeRegex).join("|")})\\b`, "gi");
  const found = [...new Set((text.match(re) || []).map((w) => w.toLowerCase()))];
  return found.length
    ? { level: "warn", text: `Words to ${verb}: ${found.join(", ")}.` }
    : { level: "ok", text: "None of your words to avoid." };
}

export function resumeChecks(md: string, s: Settings): Check[] {
  const res: Check[] = [];
  const txt = plain(md);

  if (s.flagDashes) {
    const n = (md.match(DASHES) || []).length;
    res.push(n ? { level: "fail", text: `${n} em or en dash${n > 1 ? "es" : ""} found. Replace with a hyphen.` } : { level: "ok", text: "No em or en dashes." });
  }

  for (const phrase of s.mustInclude.map((p) => p.trim()).filter(Boolean)) {
    const has = new RegExp(`\\b${escapeRegex(phrase)}\\b`, "i").test(txt);
    res.push(has ? { level: "ok", text: `Includes "${phrase}".` } : { level: "fail", text: `"${phrase}" is missing from this version.` });
  }

  const tone = toneCheck(txt, s.toneWords, "replace");
  if (tone) res.push(tone);

  const claims = s.experienceClaims.filter((c) => c.area.trim() && c.years > 0);
  if (claims.length) {
    const bad: string[] = [];
    // Longest areas first, so "product leadership" is matched before "product".
    const areas = claims.map((c) => c.area.trim()).sort((a, b) => b.length - a.length);
    const re = new RegExp(`(\\d+)\\+?\\s*(?:years?\\s+)?(?:of\\s+)?(?:experience\\s+)?in\\s+(${areas.map(escapeRegex).join("|")})\\b`, "gi");
    for (const m of txt.matchAll(re)) {
      const claim = claims.find((c) => c.area.trim().toLowerCase() === m[2].toLowerCase());
      if (claim && Number(m[1]) !== claim.years) bad.push(`${m[1]} in ${m[2]} (yours: ${claim.years})`);
    }
    res.push(bad.length ? { level: "fail", text: `Experience years don't match your settings: ${bad.join("; ")}.` } : { level: "ok", text: "Experience years match your settings." });
  }

  if (s.teamSizes.length) {
    const odd = [...txt.matchAll(/(\d+)\s+direct reports/gi)].map((m) => Number(m[1])).filter((n) => !s.teamSizes.includes(n));
    res.push(
      odd.length
        ? { level: "warn", text: `Team size ${odd.join(", ")} isn't one of yours (${s.teamSizes.join(", ")}).` }
        : { level: "ok", text: "Team sizes match your settings." },
    );
  }
  return res;
}

export const HEADLINE_MAX = 220;

export function headlineChecks(text: string, s: Settings, currentResume: { label: string; content: string } | null): Check[] {
  const out: Check[] = [];
  const len = [...text].length;
  out.push(
    len > HEADLINE_MAX
      ? { level: "fail", text: `${len} characters, ${len - HEADLINE_MAX} over LinkedIn's ${HEADLINE_MAX} limit.` }
      : { level: "ok", text: `${len} of ${HEADLINE_MAX} characters.` },
  );
  if (s.flagDashes) {
    out.push(DASHES.test(text) ? { level: "fail", text: "Em or en dash found. Use a hyphen or a pipe." } : { level: "ok", text: "No em or en dashes." });
    DASHES.lastIndex = 0;
  }
  if (currentResume) {
    const resume = plain(currentResume.content).replace(/\s+/g, " ");
    const figures = [...new Set(text.match(/(?<![A-Za-z0-9])\$?\d[\d.,]*[%xXKMB]*\+?(?![A-Za-z0-9])/g) || [])]
      .map((f) => f.trim())
      .filter((f) => /\d/.test(f) && !/^\d{1,2}$/.test(f));
    const missing = figures.filter((f) => !resume.includes(f));
    if (figures.length)
      out.push(
        missing.length
          ? { level: "warn", text: `Not on your current resume (${currentResume.label}) as written: ${missing.join(", ")}. Check they match.` }
          : { level: "ok", text: `Figures match your current resume (${figures.join(", ")}).` },
      );
  }
  const tone = toneCheck(text, s.toneWords, "reconsider");
  if (tone && tone.level === "warn") out.push(tone);
  return out;
}

/** Reads the highest number from a pay range such as "$180K - $210K" or "150,000-175,000". */
export function topOfRange(txt: string): number | null {
  if (!txt) return null;
  const nums = [...String(txt).replace(/,/g, "").matchAll(/\$?\s*(\d+(?:\.\d+)?)\s*([kK])?/g)]
    .map((m) => {
      let n = parseFloat(m[1]);
      if (m[2] || n < 1000) n *= 1000;
      return n;
    })
    .filter((n) => n >= 20000);
  return nums.length ? Math.max(...nums) : null;
}

export function applicationFlags(a: Application, s: Settings, today: string): string[] {
  const flags: string[] = [];
  const top = topOfRange(a.base);
  if (!a.base) flags.push("No pay range listed - ask early");
  else if (s.payFloor > 0 && top && top < s.payFloor) flags.push(`Pay tops out under $${Math.round(s.payFloor / 1000)}K`);
  if (a.bonus === "Not mentioned") flags.push("No bonus mentioned - ask about structure");
  if (a.setup && s.flaggedSetups.includes(a.setup)) flags.push(a.setup);
  if (a.nextDate && a.nextDate < today && !["Closed", "Offer"].includes(a.status)) flags.push("Next step overdue");
  return flags;
}
