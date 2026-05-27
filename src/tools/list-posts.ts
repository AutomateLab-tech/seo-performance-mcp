import { z } from "zod";
import { listPosts } from "../adapters/posts.js";

export const listPostsInputSchema = z.object({
  sitemap_url: z.string().url().optional().describe(
    "URL of an XML sitemap to enumerate posts. Overrides POSTS_SITEMAP_URL env var. Required if neither POSTS_SITEMAP_URL nor POSTS_LIST is set.",
  ),
  urls: z.array(z.string().url()).optional().describe(
    "Explicit list of post URLs to return directly, bypassing sitemap discovery.",
  ),
  since: z.string().optional().describe("ISO date - only return posts published after this date."),
  min_age_days: z.number().int().min(0).optional().describe("Skip posts younger than this many days."),
  limit: z.number().int().min(1).max(500).optional().default(50),
});

export type ListPostsInput = z.infer<typeof listPostsInputSchema>;

export async function listPostsTool(input: ListPostsInput): Promise<{
  posts: Array<{ slug: string; url: string; title: string; published_at: string; age_days: number; status: string; tags: string[] }>;
}> {
  if (input.urls && input.urls.length > 0) {
    // Fast path: caller provided explicit URLs, skip discovery
    const { getPostMeta } = await import("../adapters/posts.js");
    const metas = await Promise.all(input.urls.map(getPostMeta));
    return { posts: metas };
  }

  const posts = await listPosts({
    sitemapUrl: input.sitemap_url,
    since: input.since,
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
