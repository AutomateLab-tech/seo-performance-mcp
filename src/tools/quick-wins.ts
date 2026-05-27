// Quick wins: pages sitting on the edge of page 1 of GSC (positions 5-15).
// Pulls top queries with low CTR for fast title-rewrite wins. Standalone GSC scan
// (no Ghost dependency) so it can also surface non-Ghost URLs on the same property.

import { z } from "zod";
import { google } from "googleapis";
import { decodeJsonEnv, requireEnv } from "../config.js";

export const quickWinsInputSchema = z.object({
  min_position: z.number().min(1).optional().default(5),
  max_position: z.number().min(1).optional().default(15),
  min_impressions: z.number().int().min(0).optional().default(100),
  window: z.union([z.literal(30), z.literal(60), z.literal(90)]).optional().default(30),
  limit: z.number().int().min(1).max(200).optional().default(50),
});

export type QuickWinsInput = z.infer<typeof quickWinsInputSchema>;

export interface QuickWin {
  url: string;
  query: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
}

export async function quickWinsTool(input: QuickWinsInput): Promise<{ wins: QuickWin[] }> {
  const siteUrl = requireEnv("GSC_SITE_URL");
  const creds = decodeJsonEnv<{ client_email: string; private_key: string }>(
    "GSC_SERVICE_ACCOUNT_JSON",
  );
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
  const sc = google.searchconsole({ version: "v1", auth });

  const startDate = daysAgo(input.window);
  const endDate = daysAgo(1);

  const res = await sc.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions: ["page", "query"],
      rowLimit: input.limit * 4,
    },
  });

  const wins = (res.data.rows ?? [])
    .map((row) => ({
      url: String(row.keys?.[0] ?? ""),
      query: String(row.keys?.[1] ?? ""),
      impressions: row.impressions ?? 0,
      clicks: row.clicks ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? 0,
    }))
    .filter((r) =>
      r.position >= input.min_position &&
      r.position <= input.max_position &&
      r.impressions >= input.min_impressions,
    )
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, input.limit);

  return { wins };
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
