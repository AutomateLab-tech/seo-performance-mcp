// Generic post-metadata adapter. Works with any public URL.
//
// Metadata is resolved in priority order:
//   1. POSTS_LIST env var  - JSON array of {url, title?, published_at?, tags?, word_count?}
//   2. Ghost Admin API     - only if GHOST_ADMIN_API_URL is set (optional enrichment)
//   3. HTML og: / JSON-LD  - fetched live from the URL itself
//   4. Sitemap <lastmod>   - when discovering posts via POSTS_SITEMAP_URL
//
// To integrate any CMS, set POSTS_SITEMAP_URL to its XML sitemap and
// optionally POSTS_LIST to a richer JSON override.

import { request } from "undici";
import { XMLParser } from "fast-xml-parser";
import { getEnv } from "../config.js";
import type { PostMeta } from "../types.js";

export interface PostListEntry {
  url: string;
  title?: string;
  published_at?: string;
  updated_at?: string;
  tags?: string[];
  word_count?: number;
  headings?: string[];
  excerpt?: string;
}

// ---------------------------------------------------------------------------
// Public API

export async function getPostMeta(url: string): Promise<PostMeta> {
  const override = postsFromEnv().find((p) => normalizeUrl(p.url) === normalizeUrl(url));
  let meta: PostMeta;
  if (override?.title && override?.published_at) {
    meta = buildMeta({ ...override, url });
  } else {
    const fromGhost = await fetchMetaFromGhost(url);
    if (fromGhost) {
      meta = fromGhost;
    } else {
      const fromHtml = await fetchMetaFromHtml(url);
      meta = buildMeta({ ...override, ...fromHtml, url });
    }
  }

  if (!meta.headings || !meta.excerpt) {
    const enrichment = await fetchMetaFromHtml(url);
    if (!meta.headings && enrichment.headings) meta.headings = enrichment.headings;
    if (!meta.excerpt && enrichment.excerpt) meta.excerpt = enrichment.excerpt;
  }

  return meta;
}

async function fetchMetaFromGhost(url: string): Promise<PostMeta | undefined> {
  if (!getEnv("GHOST_ADMIN_API_URL") || !getEnv("GHOST_ADMIN_API_KEY")) return undefined;
  try {
    const ghost = await import("./ghost.js");
    const slug = slugFromUrl(url);
    const meta = await ghost.getPostBySlug(slug);
    return meta ?? undefined;
  } catch {
    return undefined;
  }
}

export interface ListOptions {
  sitemapUrl?: string;
  since?: string;
  minAgeDays?: number;
  limit?: number;
}

export async function listPosts(opts: ListOptions = {}): Promise<PostMeta[]> {
  const env = postsFromEnv();
  let posts: PostMeta[];

  if (env.length > 0) {
    posts = env.map((e) => buildMeta(e));
  } else {
    const sitemapUrl = opts.sitemapUrl ?? getEnv("POSTS_SITEMAP_URL");
    if (sitemapUrl) {
      posts = await fetchFromSitemap(sitemapUrl);
    } else if (getEnv("GHOST_ADMIN_API_URL") && getEnv("GHOST_ADMIN_API_KEY")) {
      const ghost = await import("./ghost.js");
      posts = await ghost.listPosts({
        since: opts.since,
        minAgeDays: opts.minAgeDays,
        limit: opts.limit,
      });
    } else {
      throw new Error(
        "No post source configured. Set POSTS_SITEMAP_URL (XML sitemap), POSTS_LIST (JSON array of {url,...}), or GHOST_ADMIN_API_URL+GHOST_ADMIN_API_KEY.",
      );
    }
  }

  if (opts.since) {
    const sinceMs = new Date(opts.since).getTime();
    posts = posts.filter((p) => p.published_at && new Date(p.published_at).getTime() > sinceMs);
  }
  if (opts.minAgeDays) {
    posts = posts.filter((p) => p.age_days >= (opts.minAgeDays ?? 0));
  }
  if (opts.limit) {
    posts = posts.slice(0, opts.limit);
  }
  return posts;
}

// ---------------------------------------------------------------------------
// Internals

function postsFromEnv(): PostListEntry[] {
  const raw = getEnv("POSTS_LIST");
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PostListEntry[];
  } catch {
    return [];
  }
}

function buildMeta(p: PostListEntry): PostMeta {
  return {
    slug: slugFromUrl(p.url),
    url: p.url,
    title: p.title ?? p.url,
    published_at: p.published_at ?? "",
    updated_at: p.updated_at,
    age_days: ageDays(p.published_at),
    status: "published",
    tags: p.tags ?? [],
    word_count: p.word_count,
    headings: p.headings,
    excerpt: p.excerpt,
  };
}

async function fetchMetaFromHtml(url: string): Promise<Partial<PostListEntry>> {
  try {
    const res = await request(url, {
      headers: { "User-Agent": "seo-performance-mcp/0.1 (+https://github.com/AutomateLab-tech/seo-performance-mcp)" },
    });
    if (res.statusCode < 200 || res.statusCode >= 300) return {};
    const html = await res.body.text();
    return {
      title: ogTag(html, "og:title") ?? htmlTitle(html),
      published_at: ogTag(html, "article:published_time") ?? jsonLdDate(html, "datePublished"),
      updated_at: ogTag(html, "article:modified_time") ?? jsonLdDate(html, "dateModified"),
      tags: ogTags(html, "article:tag"),
      headings: extractHeadings(html),
      excerpt: extractBodyExcerpt(html),
    };
  } catch {
    return {};
  }
}

interface SitemapEntry { loc: string; lastmod?: string }

async function fetchFromSitemap(sitemapUrl: string): Promise<PostMeta[]> {
  const entries = await parseSitemap(sitemapUrl);
  return entries.map((e) => buildMeta({ url: e.loc, published_at: e.lastmod }));
}

async function parseSitemap(url: string, depth = 0): Promise<SitemapEntry[]> {
  if (depth > 2) return [];
  let xml: string;
  try {
    const res = await request(url, {
      headers: { "User-Agent": "seo-performance-mcp/0.1" },
    });
    if (res.statusCode < 200 || res.statusCode >= 300) return [];
    xml = await res.body.text();
  } catch {
    return [];
  }

  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml) as Record<string, unknown>;

  // Sitemap index
  const idx = parsed["sitemapindex"] as Record<string, unknown> | undefined;
  if (idx) {
    const sitemapEl = idx["sitemap"];
    const children: Array<Record<string, unknown>> = Array.isArray(sitemapEl)
      ? (sitemapEl as Array<Record<string, unknown>>)
      : sitemapEl
      ? [sitemapEl as Record<string, unknown>]
      : [];
    const nested: SitemapEntry[] = [];
    for (const c of children) {
      const loc = String(c["loc"] ?? "");
      if (loc) nested.push(...(await parseSitemap(loc, depth + 1)));
    }
    return nested;
  }

  // Regular sitemap
  const urlset = parsed["urlset"] as Record<string, unknown> | undefined;
  if (!urlset) return [];
  const urlEl = urlset["url"];
  const urls: Array<Record<string, unknown>> = Array.isArray(urlEl)
    ? (urlEl as Array<Record<string, unknown>>)
    : urlEl
    ? [urlEl as Record<string, unknown>]
    : [];
  return urls.map((u) => ({
    loc: String(u["loc"] ?? ""),
    lastmod: u["lastmod"] ? String(u["lastmod"]) : undefined,
  })).filter((u) => u.loc);
}

// ---------------------------------------------------------------------------
// HTML helpers

function ogTag(html: string, property: string): string | undefined {
  const m = html.match(new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"))
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, "i"));
  return m?.[1];
}

function ogTags(html: string, property: string): string[] {
  const re = new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

function htmlTitle(html: string): string | undefined {
  return html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
}

function extractHeadings(html: string): string[] {
  const re = /<h([12])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (text) out.push(text);
    if (out.length >= 20) break;
  }
  return out;
}

function extractBodyExcerpt(html: string, maxChars = 4000): string {
  let body = html;
  const article = html.match(/<article\b[\s\S]*?>([\s\S]*?)<\/article>/i);
  if (article) {
    body = article[1];
  } else {
    const main = html.match(/<main\b[\s\S]*?>([\s\S]*?)<\/main>/i);
    if (main) body = main[1];
  }
  body = body.replace(/<script[\s\S]*?<\/script>/gi, "");
  body = body.replace(/<style[\s\S]*?<\/style>/gi, "");
  body = body.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  const text = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, maxChars);
}

function jsonLdDate(html: string, key: string): string | undefined {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const obj = JSON.parse(m[1]) as Record<string, unknown>;
      if (obj[key]) return String(obj[key]);
    } catch {
      // try next block
    }
  }
  return undefined;
}

export function slugFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/$/, "");
    const parts = path.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? (path || url);
  } catch {
    return url;
  }
}

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, "").toLowerCase();
}

function ageDays(publishedAt?: string): number {
  if (!publishedAt) return 0;
  const ms = Date.now() - new Date(publishedAt).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}
