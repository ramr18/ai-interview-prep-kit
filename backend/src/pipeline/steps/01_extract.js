import { makeIdGen } from "../../lib/ids.js";
import { orEnum } from "../kitSchema.js";
import { CATEGORIES, PRIORITIES } from "../kitSchema.js";

/**
 * Step 1 - requirement extraction. Operates on the pasted job description
 * ONLY (no retrieval for pasted text, per the brief). Returns raw model
 * output; stable ids (r1, r2, ...) are assigned here in code, never by the
 * model, which is what makes coverage mechanically checkable.
 */
export async function stepExtract(ctx, { jd }) {
  ctx.emit({ type: "phase", name: "extract", status: "start" });
  const thin = String(jd).trim().length < 180;

  const res = await ctx.gen({
    step: "extract",
    payload: { jd: String(jd).slice(0, 12000) },
  });

  const rawReqs = Array.isArray(res?.requirements) ? res.requirements : [];
  const reqId = makeIdGen("r");
  const seen = new Set();
  const requirements = [];
  for (const r of rawReqs) {
    const text = String(r?.text || "").trim();
    if (text.length < 4) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const explicitlyNice = /\b(preferred|bonus|nice[- ]to[- ]have|good to have|desired|optional)\b/i.test(text);
    requirements.push({
      id: reqId(),
      text,
      priority: explicitlyNice ? "nice" : orEnum(r?.priority, PRIORITIES, "must"),
      category: orEnum(r?.category, CATEGORIES, "other"),
    });
  }

  // Hard model guard: a non-thin posting that yields nothing is reported
  // honestly (thin kit) rather than padded with invented requirements.
  const thinDescription = thin || requirements.length === 0;
  const title = String(res?.title || "").trim().slice(0, 120);
  const summary = String(res?.summary || "").trim().slice(0, 500);

  ctx.emit({
    type: "phase",
    name: "extract",
    status: "ok",
    detail: `${requirements.length} requirement${requirements.length === 1 ? "" : "s"} extracted`,
  });
  return { title, summary, requirements, thinDescription };
}