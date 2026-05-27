import { z } from "zod";
import { getPostBySlug } from "../adapters/ghost.js";
import { fetchCitationMetrics } from "../adapters/citation.js";

export const citeLossInputSchema = z.object({
  slug: z.string().min(1),
});

export type CiteLossInput = z.infer<typeof citeLossInputSchema>;

export async function citeLossTool(input: CiteLossInput): Promise<{
  slug: string;
  active: number;
  losses: Array<{ llm: string; query: string; last_seen: string; replaced_by_url?: string }>;
}> {
  const post = await getPostBySlug(input.slug);
  if (!post) throw new Error(`No post with slug ${input.slug}`);
  const c = await fetchCitationMetrics(post.url);
  return {
    slug: input.slug,
    active: c.active_citations,
    losses: c.llms,
  };
}
