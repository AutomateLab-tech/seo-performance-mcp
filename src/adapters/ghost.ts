// Ghost Admin API adapter - lists posts and reads metadata for slug -> URL resolution.
// Auth: JWT signed with Ghost Admin API key (id:secret).

import { request } from "undici";
import { createHmac } from "node:crypto";
import { getEnv } from "../config.js";
import type { PostMeta } from "../types.js";

interface GhostPost {
  id: string;
  slug: string;
  title: string;
  url?: string;
  status: "published" | "draft" | "scheduled";
  published_at?: string;
  updated_at?: string;
  tags?: Array<{ slug: string; name: string }>;
  html?: string;
  reading_time?: number;
}

function ghostJwt(): string {
  const key = getEnv("GHOST_ADMIN_API_KEY");
  if (!key) throw new Error("Missing required env: GHOST_ADMIN_API_KEY");
  const [id, secret] = key.split(":");
  if (!id || !secret) throw new Error("GHOST_ADMIN_API_KEY must be in the form id:secret");

  const header = { alg: "HS256", typ: "JWT", kid: id };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now, exp: now + 5 * 60, aud: "/admin/" };

  const b64 = (o: object): string =>
    Buffer.from(JSON.stringify(o))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const head = b64(header);
  const body = b64(payload);
  const sig = createHmac("sha256", Buffer.from(secret, "hex"))
    .update(`${head}.${body}`)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${head}.${body}.${sig}`;
}

function ghostBase(): string {
  const url = getEnv("GHOST_ADMIN_API_URL");
  if (!url) throw new Error("Missing required env: GHOST_ADMIN_API_URL");
  return url.replace(/\/$/, "");
}

function wordCountFromHtml(html?: string): number | undefined {
  if (!html) return undefined;
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return 0;
  return text.split(" ").length;
}

function ageDays(publishedAt?: string): number {
  if (!publishedAt) return 0;
  const ms = Date.now() - new Date(publishedAt).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function toMeta(p: GhostPost): PostMeta {
  return {
    slug: p.slug,
    url: p.url ?? "",
    title: p.title,
    published_at: p.published_at ?? "",
    updated_at: p.updated_at,
    age_days: ageDays(p.published_at),
    status: p.status,
    tags: (p.tags ?? []).map((t) => t.slug),
    word_count: wordCountFromHtml(p.html),
  };
}

export interface ListPostsOptions {
  since?: string;
  tag?: string;
  minAgeDays?: number;
  limit?: number;
}

export async function listPosts(opts: ListPostsOptions = {}): Promise<PostMeta[]> {
  const base = ghostBase();
  const token = ghostJwt();
  const limit = opts.limit ?? 50;
  const filterParts: string[] = ["status:published"];
  if (opts.since) filterParts.push(`published_at:>'${opts.since}'`);
  if (opts.tag) filterParts.push(`tag:${opts.tag}`);
  const filter = encodeURIComponent(filterParts.join("+"));
  const url = `${base}/ghost/api/admin/posts/?limit=${limit}&filter=${filter}&fields=id,slug,title,url,status,published_at,updated_at,reading_time&include=tags`;

  const res = await request(url, {
    headers: { Authorization: `Ghost ${token}` },
  });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const body = await res.body.text();
    throw new Error(`Ghost API ${res.statusCode}: ${body}`);
  }
  const json = (await res.body.json()) as { posts: GhostPost[] };
  const minAge = opts.minAgeDays ?? 0;
  return json.posts
    .map(toMeta)
    .filter((p) => p.age_days >= minAge);
}

export async function getPostBySlug(slug: string): Promise<PostMeta | null> {
  const base = ghostBase();
  const token = ghostJwt();
  const url = `${base}/ghost/api/admin/posts/slug/${encodeURIComponent(slug)}/?include=tags&fields=id,slug,title,url,status,published_at,updated_at`;
  const res = await request(url, {
    headers: { Authorization: `Ghost ${token}` },
  });
  if (res.statusCode === 404) return null;
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const body = await res.body.text();
    throw new Error(`Ghost API ${res.statusCode}: ${body}`);
  }
  const json = (await res.body.json()) as { posts: GhostPost[] };
  const p = json.posts[0];
  return p ? toMeta(p) : null;
}
