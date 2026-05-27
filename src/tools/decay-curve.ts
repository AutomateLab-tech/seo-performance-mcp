import { z } from "zod";
import { buildDecayCurve } from "../store/ingest.js";
import type { DecayCurve } from "../types.js";

export const decayCurveInputSchema = z.object({
  slug: z.string().min(1),
  weeks: z.number().int().min(4).max(52).optional().default(12),
});

export type DecayCurveInput = z.infer<typeof decayCurveInputSchema>;

export async function decayCurveTool(input: DecayCurveInput): Promise<DecayCurve> {
  return buildDecayCurve(input.slug, input.weeks);
}
