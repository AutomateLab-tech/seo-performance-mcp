// Bing quick wins: queries sitting on the edge of page 1 of Bing (positions 5-15)
// with non-trivial impressions. The Bing Webmaster Tools API has no single
// page+query call, so results are query-level (no page attached), unlike the GSC
// equivalent which returns (page, query) pairs. Defaults skew lower than GSC's
// because Bing search volume is smaller.

import { z } from "zod";
import { bingQuickWins, type BingQuickWin } from "../adapters/bing.js";

export const bingQuickWinsInputSchema = z.object({
  min_position: z.number().min(1).optional().default(5).describe(
    "Minimum average Bing position to include. Defaults to 5 (top of page 1).",
  ),
  max_position: z.number().min(1).optional().default(15).describe(
    "Maximum average Bing position to include. Defaults to 15 (bottom of page 2).",
  ),
  min_impressions: z.number().int().min(0).optional().default(30).describe(
    "Minimum total impressions to include. Filters out long-tail noise. Default 30 (lower than GSC; Bing volume is smaller).",
  ),
  window: z.union([z.literal(30), z.literal(60), z.literal(90)]).optional().default(90).describe(
    "Lookback window in days, applied to Bing's weekly buckets. One of 30, 60, or 90. Default 90.",
  ),
  limit: z.number().int().min(1).max(200).optional().default(50).describe(
    "Maximum number of queries to return. Defaults to 50; cap is 200.",
  ),
});

export type BingQuickWinsInput = z.infer<typeof bingQuickWinsInputSchema>;

export async function bingQuickWinsTool(
  input: BingQuickWinsInput,
): Promise<{ wins: BingQuickWin[] }> {
  const wins = await bingQuickWins({
    minPosition: input.min_position,
    maxPosition: input.max_position,
    minImpressions: input.min_impressions,
    windowDays: input.window,
    limit: input.limit,
  });
  return { wins };
}
