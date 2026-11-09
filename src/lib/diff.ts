import { esc, plain } from "./markdown";

type Op = ["same" | "add" | "del", string];

// Longest common subsequence: the standard way to find what stayed the same between two lists.
function lcsOps(A: string[], B: string[]): Op[] {
  const n = A.length;
  const m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      ops.push(["same", A[i]]);
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) ops.push(["del", A[i++]]);
    else ops.push(["add", B[j++]]);
  }
  while (i < n) ops.push(["del", A[i++]]);
  while (j < m) ops.push(["add", B[j++]]);
  return ops;
}

export interface LineDiff {
  add: number;
  del: number;
  /** Empty when the two texts are the same. */
  html: string;
}

/** Line-by-line comparison of two resume versions. Unchanged stretches are collapsed. */
export function lineDiff(aTxt: string, bTxt: string): LineDiff {
  const split = (t: string) =>
    t
      .replace(/\r/g, "")
      .split("\n")
      .filter((l) => l.trim());
  const ops = lcsOps(split(aTxt), split(bTxt));
  let add = 0;
  let del = 0;
  let html = "";
  let skipped = 0;
  const keep = ops.map((o, k) => o[0] !== "same" || ops.slice(Math.max(0, k - 1), k + 2).some((p) => p[0] !== "same"));
  const gap = (n: number) => `<div class="gap">${n} unchanged line${n > 1 ? "s" : ""}</div>`;
  const label = { add: "Added: ", del: "Removed: ", same: "" };
  ops.forEach((o, k) => {
    if (o[0] === "add") add++;
    if (o[0] === "del") del++;
    if (!keep[k]) {
      skipped++;
      return;
    }
    if (skipped) {
      html += gap(skipped);
      skipped = 0;
    }
    // The visually hidden label means screen reader users hear the change, not only see its color.
    html += `<div class="dl ${o[0]}">${label[o[0]] ? `<span class="sr-only">${label[o[0]]}</span>` : ""}${esc(plain(o[1]))}</div>`;
  });
  if (skipped && html) html += gap(skipped);
  return { add, del, html: add || del ? html : "" };
}

/** Word-by-word comparison, used for headlines. Returns HTML with <ins> and <del>. */
export function wordDiff(a: string, b: string): string {
  const tokens = (s: string) => s.split(/(\s+)/).filter(Boolean);
  const isSpace = (s: string) => /^\s+$/.test(s);
  return lcsOps(tokens(a), tokens(b))
    .map(([kind, tok]) => {
      if (kind === "same" || isSpace(tok)) return esc(tok);
      return kind === "add" ? `<ins>${esc(tok)}</ins>` : `<del>${esc(tok)}</del>`;
    })
    .join("");
}
