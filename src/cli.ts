#!/usr/bin/env node
// CLI wrapper around seo-performance MCP tools.
// Lets the package be used from GitHub Actions and ad-hoc scripts without
// having to speak MCP/JSON-RPC.

import { readFileSync, writeFileSync } from "node:fs";
import type { ZodSchema } from "zod";

import { listPostsTool, listPostsInputSchema } from "./tools/list-posts.js";
import { snapshotTool, snapshotInputSchema } from "./tools/snapshot.js";
import { decayCurveTool, decayCurveInputSchema } from "./tools/decay-curve.js";
import { verdictTool, verdictInputSchema } from "./tools/verdict.js";
import { refreshBriefTool, refreshBriefInputSchema } from "./tools/refresh-brief.js";
import { cohortReportTool, cohortReportInputSchema } from "./tools/cohort-report.js";
import { citeLossTool, citeLossInputSchema } from "./tools/cite-loss.js";
import { quickWinsTool, quickWinsInputSchema } from "./tools/quick-wins.js";

interface ToolEntry {
  schema: ZodSchema<any>;
  fn: (input: any) => Promise<unknown>;
}

const TOOLS: Record<string, ToolEntry> = {
  "posts.list": { schema: listPostsInputSchema, fn: listPostsTool },
  "posts.snapshot": { schema: snapshotInputSchema, fn: snapshotTool },
  "posts.decay_curve": { schema: decayCurveInputSchema, fn: decayCurveTool },
  "posts.verdict": { schema: verdictInputSchema, fn: verdictTool },
  "posts.refresh_brief": { schema: refreshBriefInputSchema, fn: refreshBriefTool },
  "cohort.report": { schema: cohortReportInputSchema, fn: cohortReportTool },
  "posts.cite_loss": { schema: citeLossInputSchema, fn: citeLossTool },
  "gsc.quick_wins": { schema: quickWinsInputSchema, fn: quickWinsTool },
};

type Format = "json" | "markdown";

interface ParsedArgs {
  tool: string;
  input: string;
  inputFile: string | null;
  format: Format;
  out: string | null;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    tool: "",
    input: "{}",
    inputFile: null,
    format: "json",
    out: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-i":
      case "--input":
        result.input = argv[++i] ?? "{}";
        break;
      case "--input-file":
        result.inputFile = argv[++i] ?? null;
        break;
      case "-f":
      case "--format": {
        const v = argv[++i];
        if (v === "json" || v === "markdown") result.format = v;
        else throw new Error(`--format must be json or markdown, got: ${v}`);
        break;
      }
      case "-o":
      case "--out":
        result.out = argv[++i] ?? null;
        break;
      case "-h":
      case "--help":
        result.help = true;
        break;
      default:
        if (!result.tool && !a.startsWith("-")) {
          result.tool = a;
        } else if (a.startsWith("-")) {
          throw new Error(`Unknown flag: ${a}`);
        }
    }
  }

  return result;
}

function normalizeToolName(name: string): string {
  // Accept either canonical dot.snake_case (posts.refresh_brief) or the all-snake
  // variant (posts_refresh_brief) by promoting the first underscore to a dot when
  // the name lacks one.
  if (name.includes(".") || !(name in TOOLS)) {
    if (!(name in TOOLS) && !name.includes(".")) {
      const i = name.indexOf("_");
      if (i > 0) {
        const candidate = name.slice(0, i) + "." + name.slice(i + 1);
        if (candidate in TOOLS) return candidate;
      }
    }
  }
  return name;
}

function printHelp(): void {
  const tools = Object.keys(TOOLS).map((t) => `  ${t}`).join("\n");
  process.stdout.write(
    `seo-perf-cli <tool> [options]\n\n` +
      `Wraps every seo-performance MCP tool as a one-shot CLI call. Same env vars\n` +
      `as the MCP server. Output is JSON unless --format markdown is set (markdown\n` +
      `is supported for cohort.report and posts.refresh_brief).\n\n` +
      `Tools:\n${tools}\n\n` +
      `Options:\n` +
      `  -i, --input   <json>            Tool input as a JSON string. Default: {}\n` +
      `      --input-file <path>         Read tool input JSON from a file.\n` +
      `  -f, --format  <json|markdown>   Output format. Default: json.\n` +
      `  -o, --out     <path>            Write output to file (in addition to stdout).\n` +
      `  -h, --help                      Show this help.\n\n` +
      `Examples:\n` +
      `  seo-perf-cli cohort.report --input '{"window":90,"limit":20}' --format markdown\n` +
      `  seo-perf-cli posts.refresh_brief --input '{"url":"https://example.com/x"}' --format markdown\n` +
      `  seo-perf-cli gsc.quick_wins --input '{"window":90}'\n`,
  );
}

function renderCohortMarkdown(result: unknown): string {
  const rows = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
  if (rows.length === 0) {
    return "_No rows returned. Check sitemap, GSC config, and adapter env vars._\n";
  }
  const lines: string[] = [];
  lines.push("# Cohort report");
  lines.push("");
  lines.push(`Returned **${rows.length}** post(s), sorted by verdict priority then confidence.`);
  lines.push("");
  lines.push("| # | Post | Verdict | Conf. | Clicks | Impr. | Pos. | Age (d) | Top reasons |");
  lines.push("|---|---|---|---:|---:|---:|---:|---:|---|");
  rows.forEach((row, i) => {
    const reasons = ((row.reasons as string[] | undefined) ?? []).slice(0, 3).join(", ");
    const titleRaw = (row.title as string | undefined) ?? (row.url as string);
    const title = titleRaw.replace(/\|/g, "\\|");
    lines.push(
      `| ${i + 1} | [${title}](${row.url}) | **${row.verdict}** | ${row.confidence} | ${row.clicks} | ${row.impressions} | ${row.position} | ${row.age_days} | ${reasons} |`,
    );
  });
  lines.push("");
  return lines.join("\n") + "\n";
}

function renderMarkdown(toolName: string, result: unknown): string {
  if (toolName === "posts.refresh_brief") {
    return (result as { markdown?: string }).markdown ?? "";
  }
  if (toolName === "cohort.report") {
    return renderCohortMarkdown(result);
  }
  // Fall back to fenced JSON for tools without a dedicated renderer.
  return "```json\n" + JSON.stringify(result, null, 2) + "\n```\n";
}

async function main(): Promise<void> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    printHelp();
    process.exit(2);
  }

  if (parsed.help || !parsed.tool) {
    printHelp();
    process.exit(parsed.help ? 0 : 2);
  }

  const toolName = normalizeToolName(parsed.tool);
  const entry = TOOLS[toolName];
  if (!entry) {
    process.stderr.write(`Unknown tool: ${parsed.tool}. Known: ${Object.keys(TOOLS).join(", ")}\n`);
    process.exit(2);
  }

  const rawInput = parsed.inputFile ? readFileSync(parsed.inputFile, "utf8") : parsed.input;
  let rawParsed: unknown;
  try {
    rawParsed = rawInput.trim() === "" ? {} : JSON.parse(rawInput);
  } catch (err) {
    process.stderr.write(`Invalid input JSON: ${(err as Error).message}\n`);
    process.exit(2);
  }

  const parsedSchema = entry.schema.safeParse(rawParsed);
  if (!parsedSchema.success) {
    process.stderr.write(`Input failed schema validation for ${toolName}:\n${parsedSchema.error.toString()}\n`);
    process.exit(2);
  }

  let result: unknown;
  try {
    result = await entry.fn(parsedSchema.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Tool ${toolName} failed: ${msg}\n`);
    process.exit(1);
  }

  const output = parsed.format === "markdown" ? renderMarkdown(toolName, result) : JSON.stringify(result, null, 2) + "\n";

  process.stdout.write(output);
  if (parsed.out) {
    writeFileSync(parsed.out, output, "utf8");
    process.stderr.write(`Wrote ${output.length} chars to ${parsed.out}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`[fatal] ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
