// Turns the resume's simple Markdown into HTML for the preview, or into plain text for copying.
// Supported: # headings, * or - bullets, **bold**, [text](url) links, and a tab between a title and its dates.

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Makes text safe to place inside HTML. */
export const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Removes backslash escapes that Google Docs adds when exporting Markdown, such as \- or \$. */
export const unesc = (s: string): string => s.replace(/\\([-$~*_#\[\]().!+])/g, "$1");

function inline(s: string): string {
  let t = esc(unesc(s));
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
  t = t.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  return t;
}

const looksLikeContact = (line: string) => /(\d{3}[.\-\s]\d{3}[.\-\s]\d{4})|@/.test(line);

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let inList = false;
  let first = true;
  const close = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      close();
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^\s*[*-]\s+(.*)$/))) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push("<li>" + inline(m[1]) + "</li>");
      first = false;
      continue;
    }
    close();
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      const level = m[1].length;
      const txt = m[2].replace(/\*\*/g, "");
      if (first) out.push('<p class="name">' + inline(txt) + "</p>");
      else if (level <= 2) out.push('<h3 class="sec">' + inline(txt) + "</h3>");
      else out.push('<h4 class="co">' + inline(txt) + "</h4>");
      first = false;
      continue;
    }
    if (first && /^\*\*[^*]+\*\*$/.test(line.trim())) {
      out.push('<p class="name">' + inline(line.replace(/\*\*/g, "")) + "</p>");
      first = false;
      continue;
    }
    first = false;
    if (line.includes("\t")) {
      const [left, ...right] = line.split("\t");
      out.push(
        '<div class="row"><span>' + inline(left) + '</span><span class="r">' + inline(right.join(" ").replace(/\*\*/g, "")) + "</span></div>",
      );
      continue;
    }
    if (looksLikeContact(line) && out.length < 3) {
      out.push('<p class="contact">' + inline(line) + "</p>");
      continue;
    }
    out.push("<p>" + inline(line) + "</p>");
  }
  close();
  return out.join("\n");
}

/** Plain text version, for pasting into application forms. */
export function plain(md: string): string {
  return md
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => {
      let t = unesc(l)
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
        .replace(/\*\*/g, "")
        .replace(/^#{1,6}\s+/, "");
      t = t.replace(/^\s*[*-]\s+/, "- ").replace(/\t+/, "  |  ");
      return t;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const wordCount = (md: string): number => (plain(md).match(/\S+/g) || []).length;
export const bulletCount = (md: string): number => (md.match(/^\s*[*-]\s+/gm) || []).length;

/** Short bolded phrases that contain a number, such as **40%** or **$2M**. */
export const boldedMetrics = (md: string): string[] => [
  ...new Set([...md.matchAll(/\*\*([^*]*\d[^*]*)\*\*/g)].map((m) => unesc(m[1]).trim()).filter((x) => x.length < 24)),
];
