import { describe, it, expect } from "vitest";
import {
  parseStatDate,
  parseQueryStatsXml,
  summarizeQueryRows,
  type QueryStatsRow,
} from "../src/adapters/bing.js";

describe("parseStatDate", () => {
  it("parses POX ISO 8601 dates (the live format)", () => {
    expect(parseStatDate("2026-05-22T00:00:00")).toBe(Date.parse("2026-05-22T00:00:00"));
  });
  it("still parses the legacy JSON ASP.NET /Date(ms+-tz)/ form", () => {
    expect(parseStatDate("/Date(1316156400000-0700)/")).toBe(1316156400000);
    expect(parseStatDate("/Date(0)/")).toBe(0);
  });
  it("returns NaN for unparseable input", () => {
    expect(Number.isNaN(parseStatDate("not-a-date"))).toBe(true);
    expect(Number.isNaN(parseStatDate(""))).toBe(true);
  });
});

describe("parseQueryStatsXml", () => {
  it("parses a flat POX ArrayOfQueryStats body and decodes entities", () => {
    const xml =
      `<ArrayOfQueryStats xmlns="x"><QueryStats>` +
      `<AvgClickPosition>-1</AvgClickPosition><AvgImpressionPosition>3</AvgImpressionPosition>` +
      `<Clicks>1</Clicks><Date>2026-05-22T00:00:00</Date><Impressions>2</Impressions>` +
      `<Query>n8n &amp; make &lt;automation&gt;</Query></QueryStats></ArrayOfQueryStats>`;
    const rows = parseQueryStatsXml(xml);
    expect(rows).toHaveLength(1);
    expect(rows[0].Query).toBe("n8n & make <automation>");
    expect(rows[0].Impressions).toBe(2);
    expect(rows[0].Clicks).toBe(1);
    expect(rows[0].AvgImpressionPosition).toBe(3);
    expect(rows[0].Date).toBe("2026-05-22T00:00:00");
  });
  it("returns [] for an empty self-closing body", () => {
    expect(parseQueryStatsXml(`<ArrayOfQueryStats xmlns="x"/>`)).toEqual([]);
  });
});

function row(query: string, dateMs: number, impr: number, clicks: number, pos: number): QueryStatsRow {
  return {
    Query: query,
    Impressions: impr,
    Clicks: clicks,
    AvgImpressionPosition: pos,
    AvgClickPosition: pos,
    Date: `/Date(${dateMs})/`,
  };
}

describe("summarizeQueryRows", () => {
  const sinceMs = 2000;
  const rows: QueryStatsRow[] = [
    row("alpha", 3000, 100, 10, 10),
    row("alpha", 4000, 300, 20, 6),
    row("alpha", 1000, 999, 999, 1), // before the window -> must be dropped
    row("beta", 3500, 50, 5, 4),
  ];

  it("sums clicks/impressions and impression-weights position per query", () => {
    const m = summarizeQueryRows(rows, sinceMs);
    const alpha = m.top_queries.find((q) => q.query === "alpha")!;
    // impr 400, clicks 30, posWeighted (10*100 + 6*300)/400 = 7.0, ctr 30/400
    expect(alpha.impressions).toBe(400);
    expect(alpha.clicks).toBe(30);
    expect(alpha.position).toBe(7);
    expect(alpha.ctr).toBe(0.075);
  });

  it("drops rows older than the window", () => {
    const m = summarizeQueryRows(rows, sinceMs);
    // If the 999/999 row leaked in, alpha impressions would be 1399.
    expect(m.impressions).toBe(450);
    expect(m.clicks).toBe(35);
  });

  it("derives site totals and sorts top_queries by impressions desc", () => {
    const m = summarizeQueryRows(rows, sinceMs);
    expect(m.position).toBe(6.7); // (2800 + 200) / 450
    expect(m.ctr).toBe(0.0778); // 35 / 450
    expect(m.top_queries.map((q) => q.query)).toEqual(["alpha", "beta"]);
  });

  it("windows correctly with live ISO dates too", () => {
    const isoRows: QueryStatsRow[] = [
      { Query: "x", Impressions: 10, Clicks: 1, AvgImpressionPosition: 4, AvgClickPosition: 4, Date: "2026-05-22T00:00:00" },
      { Query: "x", Impressions: 99, Clicks: 9, AvgImpressionPosition: 1, AvgClickPosition: 1, Date: "2020-01-01T00:00:00" },
    ];
    const m = summarizeQueryRows(isoRows, Date.parse("2026-01-01T00:00:00"));
    expect(m.impressions).toBe(10); // the 2020 row is outside the window
    expect(m.clicks).toBe(1);
  });
});
