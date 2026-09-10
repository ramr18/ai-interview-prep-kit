/**
 * Dev smoke test - full pipeline against a LOCAL fixture site with the mock
 * provider. Fast, deterministic, and exercises the crawler (relative links,
 * robots.txt, ranking, hiring-page discovery) without a real network trip.
 */
process.env.LLM_PROVIDER = "mock";
process.env.ALLOW_PRIVATE_URLS = "true";
process.env.REPOSITORY = "file";
process.env.LLM_RPM = "100";

const { runPipeline } = await import("../src/pipeline/runPipeline.js");
const { startFixtureSite, getFixtureBase } = await import("./testSite.mjs");

const startedServer = await startFixtureSite();
const FIXTURE_BASE = getFixtureBase();
const input = {
  jd: `Senior Software Engineer - React platform team.
We are looking for an experienced frontend engineer. You will:
- Build and own key product surfaces in React and TypeScript
- Mentor two junior engineers and run code review
- Work with product managers on roadmap and metrics

Required: 5+ years of production React experience, strong TypeScript, SQL.
Bonus: AWS, GraphQL, prior startup experience.
Apply if you love product thinking and clean code.`,
  companyUrl: FIXTURE_BASE,
  days: 7,
};

const started = Date.now();
const result = await runPipeline(input, {
  kitId: "kit-smoke-1",
  emit: (e) => {
    if (e.type === "crawl") console.log(`   crawl ${e.status} ${e.url}`);
    else if (e.status === "start") console.log(`-- ${e.type}/${e.name} start`);
    else if (["ok", "done", "crawled"].includes(e.status)) console.log(`++ ${e.type}/${e.name} ${e.status} ${e.detail || ""}`);
    else if (e.status === "error") console.log(`!! ${e.type}/${e.name} ${e.code} ${e.detail || e.message || ""}`);
  },
});
const secs = (Date.now() - started) / 1000;
startedServer.server.close();

const kit = result.kit;
console.log("\n=== smoke result ===");
console.log("ok:", result.ok, "| status:", kit.status, "| valid:", kit.valid, `| ${secs.toFixed(1)}s`);
console.log("requirements:", kit.role.requirements.length);
for (const r of kit.role.requirements) console.log(`  ${r.id} [${r.priority}/${r.category}] ${r.text.slice(0, 60)}`);
console.log("questions:", kit.questions.length);
const byCat = new Map();
for (const q of kit.questions) byCat.set(q.category, (byCat.get(q.category) || 0) + 1);
console.log("  by category:", JSON.stringify(Object.fromEntries(byCat)));
console.log("flashcards:", kit.flashcards.length);
console.log("schedule days:", kit.schedule.length, "| total mins:", kit.schedule.reduce((a, d) => a + d.durationMinutes, 0));
const musts = kit.role.requirements.filter((r) => r.priority === "must");
console.log("must reqs in schedule:", musts.filter((r) => kit.schedule.some((d) => d.requirementIds.includes(r.id))).length, "/", musts.length);
console.log("coverage gaps:", kit.gaps.length);
console.log("brief:", String(kit.company.brief).slice(0, 160));
console.log("hiring page found:", kit.company.hiringProcess.found);
console.log("notes:", JSON.stringify(kit.notes));
console.log("validation errors:", kit.validationErrors.length);

process.exit(result.ok && kit.status !== "failed" ? 0 : 1);