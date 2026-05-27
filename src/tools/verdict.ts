import { z } from "zod";
import { buildSnapshot, buildDecayCurve } from "../store/ingest.js";
import { decideVerdict } from "../verdict/rules.js";
import { saveVerdict } from "../store/duckdb.js";
import { REASON_STRINGS } from "../verdict/reasons.js";
import type { Verdict } from "../types.js";

export const verdictInputSchema = z.object({
  slug: z.string().min(1),
  window: z.union([z.literal(30), z.literal(60), z.literal(90)]).optional().default(30),
  persist: z.boolean().optional().default(false),
});

export type VerdictInput = z.infer<typeof verdictInputSchema>;

export async function verdictTool(input: VerdictInput): Promise<Verdict & { reason_strings: Record<string, string> }> {
  const [snap, decay] = await Promise.all([
    buildSnapshot(input.slug, input.window),
    buildDecayCurve(input.slug, 12),
  ]);
  const v = decideVerdict(snap, decay);
  if (input.persist) {
    await saveVerdict(v.slug, v.verdict, v.reasons, v.confidence);
  }
  const reason_strings: Record<string, string> = {};
  for (const r of v.reasons) {
    reason_strings[r] = REASON_STRINGS[r];
  }
  return { ...v, reason_strings };
}
