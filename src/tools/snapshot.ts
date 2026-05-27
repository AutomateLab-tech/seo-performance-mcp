import { z } from "zod";
import { buildSnapshot } from "../store/ingest.js";
import { saveSnapshot } from "../store/duckdb.js";
import type { Snapshot } from "../types.js";

export const snapshotInputSchema = z.object({
  slug: z.string().min(1),
  window: z.union([z.literal(30), z.literal(60), z.literal(90)]).optional().default(30),
  persist: z.boolean().optional().default(false),
});

export type SnapshotInput = z.infer<typeof snapshotInputSchema>;

export async function snapshotTool(input: SnapshotInput): Promise<Snapshot> {
  const snap = await buildSnapshot(input.slug, input.window);
  if (input.persist) {
    await saveSnapshot(input.slug, input.window, snap);
  }
  return snap;
}
