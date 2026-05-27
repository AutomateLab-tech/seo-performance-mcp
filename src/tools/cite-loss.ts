import { z } from "zod";
import { fetchCitationMetrics } from "../adapters/citation.js";

export const citeLossInputSchema = z.object({
  url: z.string().url().describe("Canonical URL of the post."),
});

export type CiteLossInput = z.infer<typeof citeLossInputSchema>;

export async function citeLossTool(input: CiteLossInput): Promise<{
  url: string;
  active: number;
  losses: Array<{ llm: string; query: string; last_seen: string; replaced_by_url?: string }>;
}> {
  const c = await fetchCitationMetrics(input.url);
  return {
    url: input.url,
    active: c.active_citations,
    losses: c.llms,
  };
}
