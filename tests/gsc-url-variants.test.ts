import { describe, it, expect } from "vitest";
import { urlVariants, pageVariantFilterGroups } from "../src/adapters/gsc.js";

describe("urlVariants", () => {
  it("yields the bare-slug variant for a deep canonical URL", () => {
    const out = urlVariants("https://example.com/blog/ai-coding/cursor-fix/");
    expect(out).toContain("https://example.com/blog/ai-coding/cursor-fix/");
    expect(out).toContain("https://example.com/cursor-fix/");
    expect(out.length).toBe(2);
  });

  it("returns single URL for an already-bare-slug URL", () => {
    const out = urlVariants("https://example.com/cursor-fix/");
    expect(out).toEqual(["https://example.com/cursor-fix/"]);
  });

  it("returns single URL for the root", () => {
    const out = urlVariants("https://example.com/");
    expect(out).toEqual(["https://example.com/"]);
  });

  it("dedupes when the bare-slug equals the canonical", () => {
    // 2-segment URL where the bare-slug derivation matches the input.
    const out = urlVariants("https://example.com/foo/");
    expect(out).toEqual(["https://example.com/foo/"]);
  });

  it("handles a 2-segment URL by promoting the last segment", () => {
    const out = urlVariants("https://example.com/cat/post/");
    expect(out).toContain("https://example.com/cat/post/");
    expect(out).toContain("https://example.com/post/");
  });

  it("returns the input unchanged for a non-parseable URL", () => {
    const out = urlVariants("not a url");
    expect(out).toEqual(["not a url"]);
  });
});

describe("pageVariantFilterGroups", () => {
  it("builds a single OR group matching every URL variant on the page dimension", () => {
    const groups = pageVariantFilterGroups("https://example.com/blog/ai-coding/cursor-fix/");
    expect(groups).toEqual([
      {
        groupType: "or",
        filters: [
          {
            dimension: "page",
            operator: "equals",
            expression: "https://example.com/blog/ai-coding/cursor-fix/",
          },
          {
            dimension: "page",
            operator: "equals",
            expression: "https://example.com/cursor-fix/",
          },
        ],
      },
    ]);
  });

  it("collapses to one filter for an already-bare-slug URL", () => {
    const groups = pageVariantFilterGroups("https://example.com/cursor-fix/");
    expect(groups[0].groupType).toBe("or");
    expect(groups[0].filters).toEqual([
      { dimension: "page", operator: "equals", expression: "https://example.com/cursor-fix/" },
    ]);
  });
});
