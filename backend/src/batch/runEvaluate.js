#!/usr/bin/env node
/**
 * Batch entry point (mandatory - Section 9).
 *
 *   npm run evaluate --input <cases.json> --output <kits.json>
 *
 * Reads an array of cases [{ id, jd, company_url, days }], runs the full
 * pipeline on each, writes a single JSON file in the shape from Appendix B.
 * Continues after one case fails, recording the failure rather than aborting.
 */
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline, clampDays } from "../pipeline/runPipeline.js";
import { validateKit } from "../pipeline/kitSchema.js";
import { generateJson } from "../lib/llm/provider.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { input: null, output: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input") args.input = argv[++i];
    else if (argv[i] === "--output") args.output = argv[++i];
  }
  return args;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const { input, output } = parseArgs(process.argv.slice(2));
  if (!input || !output) {
    console.error("Usage: npm run evaluate --input <cases.json> --output <kits.json>");
    process.exit(2);
  }

  const cases = JSON.parse(readFileSync(resolve(input), "utf8"));
  if (!Array.isArray(cases)) throw new Error("input must be a JSON array");

  console.log(`[evaluate] ${cases.length} case(s) -> ${output}`);
  const results = [];
  const started = Date.now();

  for (const c of cases) {
    const caseId = c.id || `case-${results.length + 1}`;
    const inputObj = { jd: c.jd, companyUrl: c.company_url, days: clampDays(parseInt(c.days, 10)) };
    console.log(`[evaluate] ${caseId}: starting (${inputObj.days} days)`);
    const t0 = Date.now();
    try {
      const { kit } = await runPipeline(inputObj, {
        kitId: `kit-${caseId}`,
        caseId,
        gen: generateJson,
        emit: (e) => {
          if (e.type === "phase" && ["ok", "done", "crawled"].includes(e.status)) {
            console.log(`   ${caseId}: ${e.name}/${e.status} ${e.detail || ""}`);
          }
        },
      });
      // Final validation with the expected day count.
      const check = validateKit(kit, { expectedDays: inputObj.days });
      results.push({
        id: caseId,
        kit,
        ok: check.valid,
        validationErrors: check.errors,
        durationMs: Date.now() - t0,
      });
      console.log(`   ${caseId}: done (${kit.status}, valid=${check.valid}, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      results.push({
        id: caseId,
        kit: null,
        ok: false,
        error: { code: e?.code || "pipeline_failed", message: e?.message || String(e) },
        durationMs: Date.now() - t0,
      });
      console.log(`   ${caseId}: FAILED (${e.message})`);
    }
    // Brief pause between cases to stay polite to providers.
    await sleep(500);
  }

  const outPath = resolve(output);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ results, total: cases.length, durationMs: Date.now() - started }, null, 2), "utf8");

  const passed = results.filter((r) => r.ok).length;
  console.log(`[evaluate] ${passed}/${cases.length} valid, ${((Date.now() - started) / 1000).toFixed(1)}s total`);
  console.log(`[evaluate] wrote ${outPath}`);
  process.exit(passed === cases.length ? 0 : 1);
}

main().catch((e) => {
  console.error("[evaluate] fatal:", e);
  process.exit(1);
});
