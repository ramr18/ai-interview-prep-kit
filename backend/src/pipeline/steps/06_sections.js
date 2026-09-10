import { GENERATED_STATE } from "../sectionMerge.js";

/**
 * Step 7 - company brief + role breakdown (the "written sections").
 *
 * Both get their own LLM call with their own schema. The brief is explicitly
 * coached to admit when little was retrievable - an honest brief beats a
 * fabricated one, and the eval weights thin/hard cases accordingly.
 */
export async function stepSections(ctx, { input, extraction, research, discussion, sources, questions, gaps }) {
  ctx.emit({ type: "phase", name: "sections", status: "start" });

  const hiringSummary = research.hiringProcess?.found
    ? research.hiringProcess.summary || `Found a hiring page (${research.hiringText?.length || 0} chars).`
    : "";
  const discussionSummary = discussion?.found ? discussion.summary : "";

  // --- company brief ---
  let brief = "";
  try {
    const res = await ctx.gen({
      step: "brief",
      payload: {
        companyName: research.companyName || safeHostname(input.companyUrl),
        companyUrl: input.companyUrl,
        aboutSummary: research.aboutSummary,
        hiringSummary,
        discussionSummary,
        sources,
      },
      maxOutputTokens: 1200,
    });
    brief = String(res?.brief || "").trim();
  } catch (e) {
    ctx.emit({ type: "phase", name: "sections", status: "error", section: "brief", code: e.code || "generation_failed" });
    brief = "";
  }
  if (!brief) {
    const honest = [];
    honest.push(
      `We found ${research.aboutSummary ? "limited" : "no"} information about ${research.companyName || "this company"} (${input.companyUrl}).`
    );
    if (!research.hiringProcess?.found) honest.push("No hiring-process page was retrievable.");
    if (!discussionSummary) honest.push("No public discussion of their interview process was found.");
    brief = honest.join(" ");
  }

  // --- role breakdown ---
  let roleSummary = "";
  try {
    const res = await ctx.gen({
      step: "roleSummary",
      payload: {
        title: extraction.title,
        jd: input.jd,
        requirements: extraction.requirements,
        thinDescription: extraction.thinDescription,
        gapCount: gaps.length,
      },
      maxOutputTokens: 1200,
    });
    roleSummary = String(res?.summary || "").trim();
  } catch (e) {
    ctx.emit({ type: "phase", name: "sections", status: "error", section: "rolesummary", code: e.code || "generation_failed" });
    roleSummary = "";
  }
  if (!roleSummary) {
    roleSummary = extraction.thinDescription
      ? "The posting is very thin, so this breakdown is deliberately brief: it contains few extractable requirements, and the prep kit reflects that."
      : "A breakdown of this role could not be generated; review the extracted requirements directly.";
  }

  ctx.emit({ type: "phase", name: "sections", status: "ok" });

  return {
    brief,
    briefState: GENERATED_STATE,
    roleSummary,
    roleSummaryState: GENERATED_STATE,
  };
}

export function safeHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}