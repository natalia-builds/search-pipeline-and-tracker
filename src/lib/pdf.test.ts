import { describe, expect, it } from "vitest";
import { makeResumePdf } from "./pdf";
import { normalize } from "./storage";

// A resume with a given number of jobs, so the length can be controlled.
const resume = (jobs: number) =>
  ["# Pat Lee", "pat@example.com | 555.010.0100", "## Experience"]
    .concat(
      Array.from({ length: jobs }, (_, i) =>
        [`### Company ${i + 1}`, `Product Manager\t20${10 + i} - 20${11 + i}`, "* Led a project that grew revenue by **20%** across three regions", "* Managed a team of designers and engineers through two launches"].join("\n"),
      ),
    )
    .join("\n");

// The fonts aren't served during tests, so PDFs use the built-in Helvetica.
describe("PDF page limit", () => {
  it("leaves a resume that already fits alone", async () => {
    const r = await makeResumePdf(resume(2), 1, "/");
    expect(r).toMatchObject({ pages: 1, fit: true });
  });
  it("shrinks a slightly long resume to fit the limit", async () => {
    const md = resume(11);
    const full = await makeResumePdf(md, 0, "/");
    expect(full.pages).toBe(2); // Make sure the test resume really is a bit over one page.
    expect(await makeResumePdf(md, 1, "/")).toMatchObject({ pages: 1, fit: true });
  });
  it("fits a longer resume within a two-page limit", async () => {
    const md = resume(22);
    expect((await makeResumePdf(md, 0, "/")).pages).toBe(3);
    expect(await makeResumePdf(md, 2, "/")).toMatchObject({ pages: 2, fit: true });
  });
  it("says so when the resume can't fit at a readable size", async () => {
    const r = await makeResumePdf(resume(30), 1, "/");
    expect(r.fit).toBe(false);
    expect(r.pages).toBeGreaterThan(1);
  });
  it("uses as many pages as needed with no limit", async () => {
    expect(await makeResumePdf(resume(30), 0, "/")).toMatchObject({ fit: true });
  });
});

describe("page limit setting", () => {
  it("defaults to one page for older data and rejects odd values", () => {
    expect(normalize({}).settings.pageLimit).toBe(1);
    expect(normalize({ settings: { pageLimit: 2 } }).settings.pageLimit).toBe(2);
    expect(normalize({ settings: { pageLimit: 0 } }).settings.pageLimit).toBe(0);
    expect(normalize({ settings: { pageLimit: 1.5 } }).settings.pageLimit).toBe(1);
    expect(normalize({ settings: { pageLimit: 99 } }).settings.pageLimit).toBe(1);
  });
});
