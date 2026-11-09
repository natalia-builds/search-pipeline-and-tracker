// Builds a text-based PDF of the resume, so applicant tracking systems can read it.
// jsPDF is loaded only when someone downloads a PDF, so the page itself stays small.
import type { jsPDF as JsPDF } from "jspdf";
import { unesc } from "./markdown";

export interface Fonts {
  regular: string;
  bold: string;
}

function build(JsPDFClass: typeof JsPDF, md: string, scale: number, fonts: Fonts | null, tight: boolean): JsPDF {
  const doc = new JsPDFClass({ unit: "pt", format: "letter" });
  let s = scale;
  let FACE = "helvetica";
  let L = 1;
  if (fonts) {
    doc.addFileToVFS("Carlito-Regular.ttf", fonts.regular);
    doc.addFont("Carlito-Regular.ttf", "Carlito", "normal");
    doc.addFileToVFS("Carlito-Bold.ttf", fonts.bold);
    doc.addFont("Carlito-Bold.ttf", "Carlito", "bold");
    FACE = "Carlito";
    s *= 1.1;
    L = 0.92;
  }
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = Math.round(48 * (tight ? 0.72 : s < 1 ? 0.78 : 1));
  const R = W - M;
  const ACC: [number, number, number] = [61, 133, 198];
  const INK: [number, number, number] = [67, 67, 67];
  const MUT: [number, number, number] = [102, 102, 102];
  const LINK: [number, number, number] = [17, 85, 204];
  let y = M;
  const clean = (t: string) => unesc(t).replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1").replace(/[—–]/g, "-");

  type Run = { t: string; b: boolean; url: string | null };
  // Splits a line into pieces that share the same bold state and link.
  const runs = (line: string): Run[] => {
    const src = unesc(line).replace(/[—–]/g, "-");
    const out: Run[] = [];
    const re = /\[([^\]]+)\]\(([^)\s]+)\)/g;
    let bold = false;
    let last = 0;
    let m: RegExpExecArray | null;
    const push = (txt: string, url: string | null) =>
      txt.split("**").forEach((t, i) => {
        if (i) bold = !bold;
        if (t) out.push({ t, b: bold, url });
      });
    while ((m = re.exec(src))) {
      push(src.slice(last, m.index), null);
      push(m[1], m[2]);
      last = re.lastIndex;
    }
    push(src.slice(last), null);
    return out;
  };
  const need = (h: number) => {
    if (y + h > H - M) {
      doc.addPage();
      y = M;
    }
  };

  function rich(rs: Run[], x: number, size: number, lineHeight: number, color = INK) {
    const lh = lineHeight * L;
    doc.setFontSize(size);
    doc.setTextColor(...color);
    type Tok = { w: string; b: boolean; url: string | null; sp: boolean };
    const toks: Tok[] = [];
    let pendSpace = false;
    rs.forEach((r) =>
      r.t.split(/(\s+)/).forEach((w) => {
        if (!w) return;
        if (/^\s+$/.test(w)) {
          pendSpace = true;
          return;
        }
        toks.push({ w, b: r.b, url: r.url, sp: pendSpace && toks.length > 0 });
        pendSpace = false;
      }),
    );
    const width = (t: string, b: boolean) => {
      doc.setFont(FACE, b ? "bold" : "normal");
      return doc.getTextWidth(t);
    };
    const lines: Tok[][] = [[]];
    let lw = 0;
    toks.forEach((tok) => {
      let t = tok;
      const add = width((t.sp ? " " : "") + t.w, t.b);
      if (lw + add > R - x && lines[lines.length - 1].length) {
        lines.push([]);
        t = { ...t, sp: false };
        lw = width(t.w, t.b);
      } else lw += add;
      lines[lines.length - 1].push(t);
    });
    lines.forEach((ln, li) => {
      if (li) y += lh;
      need(lh);
      let cx = x;
      let seg = "";
      let segB: boolean | null = null;
      let segU: string | null = null;
      const flush = () => {
        if (!seg) return;
        doc.setFont(FACE, segB ? "bold" : "normal");
        const tw = doc.getTextWidth(seg.trimEnd());
        if (segU) {
          doc.setTextColor(...LINK);
          doc.text(seg, cx, y);
          doc.setDrawColor(...LINK);
          doc.setLineWidth(0.5);
          doc.line(cx, y + 1.5, cx + tw, y + 1.5);
          doc.link(cx, y - size * 0.85, tw, size * 1.15, { url: segU });
          doc.setTextColor(...color);
        } else doc.text(seg, cx, y);
        cx += tw + (seg.endsWith(" ") ? doc.getTextWidth(" ") : 0);
        seg = "";
      };
      ln.forEach((t) => {
        let sp = t.sp;
        if (segB !== null && (t.b !== segB || t.url !== segU)) {
          if (sp) {
            seg += " ";
            sp = false;
          }
          flush();
        }
        segB = t.b;
        segU = t.url;
        seg += (sp ? " " : "") + t.w;
      });
      flush();
    });
    y += lh;
  }

  let first = true;
  for (const raw of md.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^\s*[*-]\s+(.*)$/))) {
      need(13);
      doc.setFillColor(...INK);
      doc.circle(M + 4, y - 3.2, 1.3, "F");
      rich(runs(m[1]), M + 12, 9.8 * s, 12.6 * s);
      y += tight ? 0.5 : 1.5;
      first = false;
      continue;
    }
    const isName = first && (/^#{1,6}\s+/.test(line) || /^\*\*[^*]+\*\*$/.test(line.trim()));
    if (isName) {
      doc.setFont(FACE, "bold");
      doc.setFontSize(20 * s);
      doc.setTextColor(...INK);
      y += 6;
      doc.text(clean(line.replace(/^#+\s+/, "")).replace(/\*\*/g, ""), M, y);
      y += 16;
      first = false;
      continue;
    }
    first = false;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      const txt = clean(m[2]).replace(/\*\*/g, "");
      if (m[1].length <= 2) {
        y += (tight ? 5 : 8) * s;
        need(24);
        doc.setFont(FACE, "bold");
        doc.setFontSize(10.5 * s);
        doc.setTextColor(...ACC);
        doc.text(txt.toUpperCase(), M, y);
        y += 4 * s;
        doc.setDrawColor(...ACC);
        doc.setLineWidth(0.6);
        doc.line(M, y, R, y);
        y += 13 * s;
      } else {
        y += 4;
        need(14);
        rich([{ t: txt, b: true, url: null }], M, 11 * s, 13.5 * s);
      }
      continue;
    }
    if (line.includes("\t")) {
      const [left, ...right] = line.split("\t");
      const r = clean(right.join(" ")).replace(/\*\*/g, "").trim();
      y += 3;
      need(13);
      doc.setFont(FACE, "normal");
      doc.setFontSize(9.5 * s);
      doc.setTextColor(...MUT);
      doc.text(r, R, y, { align: "right" });
      rich(runs(left), M, 10.5 * s, 13 * s);
      continue;
    }
    if (/(\d{3}[.\-\s]\d{3}[.\-\s]\d{4})|@/.test(line) && y < M + 60) {
      rich(runs(line), M, 9.5 * s, 12 * s, MUT);
      y += 2;
      continue;
    }
    rich(runs(line), M, 10 * s, 13 * s);
    y += 1;
  }
  return doc;
}

let fontCache: Fonts | null | undefined;
async function loadFonts(base: string): Promise<Fonts | null> {
  if (fontCache !== undefined) return fontCache;
  const b64 = async (u: string) => {
    const res = await fetch(u);
    if (!res.ok) throw new Error(String(res.status));
    const buf = new Uint8Array(await res.arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  };
  try {
    fontCache = { regular: await b64(base + "fonts/Carlito-Regular.ttf"), bold: await b64(base + "fonts/Carlito-Bold.ttf") };
  } catch {
    fontCache = null; // Falls back to Helvetica, which is built into every PDF reader.
  }
  return fontCache;
}

export interface PdfResult {
  blob: Blob;
  pages: number;
  /** False when a page limit was set but the resume didn't fit within it at a readable size. */
  fit: boolean;
}

/**
 * Builds the PDF. With a page limit (1 or more), it shrinks the text a little at a time to fit,
 * never below 84% size, then tries tighter spacing. A limit of 0 means no limit.
 */
export async function makeResumePdf(md: string, pageLimit: number, base: string): Promise<PdfResult> {
  const [{ jsPDF }, fonts] = await Promise.all([import("jspdf"), loadFonts(base)]);
  const done = (doc: JsPDF, fit: boolean): PdfResult => ({ blob: doc.output("blob"), pages: doc.getNumberOfPages(), fit });
  const full = build(jsPDF, md, 1, fonts, false);
  if (pageLimit < 1 || full.getNumberOfPages() <= pageLimit) return done(full, true);
  for (const tight of [false, true])
    for (let s = 1; s >= 0.84; s = Math.round((s - 0.02) * 100) / 100) {
      const doc = build(jsPDF, md, s, fonts, tight);
      if (doc.getNumberOfPages() <= pageLimit) return done(doc, true);
    }
  return done(full, false);
}
