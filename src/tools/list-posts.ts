import { z } from "zod";
import { listPosts } from "../adapters/ghost.js";

export const listPostsInputSchema = z.object({
  since: z.string().optional().describe("ISO date. Only return posts published after this date."),
  tag: z.string().optional().describe("Ghost tag slug to filter on."),
  min_age_days: z.number().int().min(0).optional().describe("Skip posts younger than this many days."),
  limit: z.number().int().min(1).max(200).optional().default(50),
});

export type ListPostsInput = z.infer<typeof listPostsInputSchema>;

export async function listPostsTool(input: ListPostsInput): Promise<{
  posts: Array<{ slug: string; url: string; title: string; published_at: string; age_days: number; status: string; tags: string[] }>;
}> {
  const posts = await listPosts({
    since: input.since,
    tag: input.tag,
    minAgeDays: input.min_age_days,
    limit: input.limit,
  });
  return {
    posts: posts.map((p) => ({
      slug: p.slug,
      url: p.url,
      title: p.title,
      published_at: p.published_at,
      age_days: p.age_days,
      status: p.status,
      tags: p.tags,
    })),
  };
}
