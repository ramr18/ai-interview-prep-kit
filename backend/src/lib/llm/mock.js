/**
 * Deterministic mock "model" provider.
 *
 * Lets the whole pipeline (web app and batch command) run without any API key
 * and keeps every automated test reproducible. It implements the same
 * per-step contracts as the real prompts using lightweight heuristics, so an
 * offline batch run produces a structurally valid kit.
 */

const CATEGORY_KEYWORDS = [
  [/react|node|javascript|typescript|sql|aws|gcp|azure|api|frontend|backend|full.?stack|code|software|java|python|kubernetes|docker|testing|linux|cloud|database|algorithm/i, "technical"],
  [/mentor|lead|collaborat|communicat|team|stakeholder|feedback|ownership|empathy|culture|teach|guide|learn/i, "behavioural"],
  [/product|user|customer|roadmap|metric|design|ux|analytics|growth/i, "product"],
  [/agile|scrum|sprint|ci\/cd|code review|on.?call|process|document|release/i, "process"],
];

function classifyText(text) {
  for (const [re, cat] of CATEGORY_KEYWORDS) if (re.test(text)) return cat;
  return "other";
}

const MUST_RE = /require|required|must|need|minimum|years of|experience (with|in)|expert|strong|proven|extensive|solid|plus\s*\d|5\+|\d\+\s*(years|yrs)/i;
const NICE_RE = /bonus|preferred|nice[- ]to[- ]have|plus|certification|familiar|good to have|desired|ideal|advantage|optional/i;

export function sentenceParts(text) {
  return String(text)
    .split(/\n|(?<=[.;!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function extractRequirementsHeuristic(jd) {
  const thin = jd.trim().length < 140;
  const sentenceParts = String(jd)
    .replace(/\r\n?/g, "\n")
    .split(/\n|(?<=[.;!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const requirements = [];
  const seen = new Set();
  let afterYouWill = false;

  for (const raw of sentenceParts) {
    const trimmed = raw.replace(/^[-*•\d.\s)]+/, "").trim();
    if (trimmed.length < 6) continue;
    // Skip boilerplate, but keep bullets even when they are just duties.
    if (
      /^(we are|we're|our|the company|about|join|location|apply now|salary|benefit|perks|don't|do you|what you|why|how to|covid|equal|remote)/i.test(trimmed)
    ) {
      afterYouWill = /you will\s*:\s*$/i.test(trimmed) || /^you will/i.test(trimmed) || /(?:will|should)\s+be\s+responsible/i.test(trimmed);
      continue;
    }
    const isBullet = /^[-*•\d)]/.test(raw) || afterYouWill;
    const nice = NICE_RE.test(trimmed);
    const must = !nice && (isBullet || MUST_RE.test(trimmed));
    if (!must && !nice) {
      afterYouWill = false;
      continue;
    }
    const text = trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    requirements.push({
      text,
      priority: must ? "must" : "nice",
      category: classifyText(text),
    });
    afterYouWill = false;
  }
  const trimmed = String(jd).trim();
  return { requirements, thinDescription: thin || requirements.length === 0 };
}

function trunc(s, n) {
  return s.length <= n ? s : `${s.slice(0, n - 1)}...`;
}

function verbify(text) {
  const lower = text.toLowerCase();
  if (lower.startsWith("experience with")) return text.replace(/^[Ee]xperience with\s*/, "");
  if (lower.startsWith("ability to")) return text.replace(/^[Aa]bility to\s*/, "");
  if (lower.startsWith("you will")) return text.replace(/^[Yy]ou (will|should|must)\s*/, "");
  return trunc(text, 70);
}

function companyNameFromUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host
      .replace(/^www\./, "")
      .split(".")[0]
      .split(/[-_]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  } catch {
    return "The company";
  }
}

function json(obj) {
  const text = JSON.stringify(obj);
  return { text, usage: { inputTokens: Math.ceil(text.length / 4), outputTokens: Math.ceil(text.length / 4) } };
}

const QUESTION_TEMPLATES = {
  technical: (req) => ({
    text: `Walk me through how you would approach "${trunc(req.text, 90)}". What trade-offs would you weigh and how would you verify it works?`,
    answerOutline:
      "Go concrete: the first step you take, the key decisions, how you validate the outcome, and the one thing most people miss.",
  }),
  behavioural: (req) => ({
    text: `Tell me about a time when ${trunc(verbify(req.text), 80)}. What was your role, what did you do, and what happened?`,
    answerOutline:
      "Use STAR: Situation, Task, Action, Result. One paragraph per step; end with what you learned or would change.",
  }),
  product: (req) => ({
    text: `How would you evaluate whether "${trunc(req.text, 90)}" is actually serving its users, and what would you do with what you learned?`,
    answerOutline:
      "Define the goal, pick 1-2 metrics that prove it, describe how you would gather signal, and what a pivot would look like.",
  }),
  process: (req) => ({
    text: `How do you keep "${trunc(req.text, 90)}" reliable and repeatable when the team is moving fast?`,
    answerOutline:
      "Name the process, the tooling, the review loop and how you would handle a missed deadline gracefully.",
  }),
  other: (req) => ({
    text: `Why does "${trunc(req.text, 90)}" matter in this role, and what would you point to as evidence you can deliver it?`,
    answerOutline: "Connect the requirement to day-to-day work and give one concrete proof point from your history.",
  }),
  company: (companyName) => ({
    text: `What draws you to ${companyName}, and how does your experience line up with what they do and how they hire?`,
    answerOutline:
      "Reference something specific about the company (mission, product, hiring process); tie it to one real achievement of yours.",
  }),
};

export function makeMockProvider() {
  return {
    name: "mock",

    /** @returns {{ text: string, usage: {inputTokens:number, outputTokens:number} }} */
    call(spec) {
      const p = spec.payload || {};
      const { step } = spec;

      if (step === "extract") {
        const { requirements, thinDescription } = extractRequirementsHeuristic(p.jd || "");
        const parts = sentenceParts(p.jd || "");
        const titleLine = parts[0] || "";
        const m = /\b(?:about|role|title|position)\s*[::-]\s*(.+)/i.exec(titleLine);
        const title = m ? m[1].trim() : titleLine.slice(0, 60);
        const summary = parts.slice(0, 2).join(" ").slice(0, 220);
        return json({ title, summary, thinDescription, requirements });
      }

      if (step === "classify") {
        const pages = p.pages || [];
        const hiringKeywords = /career|job|hiring|join|work[- ]with|handbook|interview|engineering|life[- ]at/i;
        let hiringPageId = null;
        for (const page of pages) {
          if (hiringKeywords.test(`${page.url} ${page.title} ${page.snippet}`)) {
            hiringPageId = page.id;
            break;
          }
        }
        const top = pages[0];
        return json({
          aboutPageId: top ? top.id : null,
          hiringPageId,
          hiringProcessFound: hiringPageId !== null,
          relevantPageIds: pages.slice(0, 3).map((x) => x.id),
        });
      }

      if (step === "research") {
        const found = p.hiringPageFound === true && (p.hiringText || "").length > 40;
        const about = trunc((p.aboutText || "No retrievable content.").replace(/\s+/g, " "), 400);
        return json({
          companyName: p.companyName || companyNameFromUrl(p.companyUrl || ""),
          aboutSummary: about,
          whatTheyDo: about,
          values: [],
          hiringProcess: {
            found,
            summary: found ? trunc((p.hiringText || "").replace(/\s+/g, " "), 300) : "No hiring process page was retrievable.",
            stages: found ? [{ name: "Application", description: "See the hiring page for stages; not enough detail to be specific." }] : [],
          },
        });
      }

      if (step === "discussion") {
        const texts = p.texts || [];
        if (texts.length === 0) return json({ found: false, summary: "", themes: [] });
        const first = trunc(texts[0].replace(/\s+/g, " "), 350);
        return json({ found: true, summary: `Public discussion topics retrieved: ${first}`, themes: ["see summary"] });
      }

      if (step === "questions" || step === "gapquestions") {
        const category = p.category || "other";
        const requirements = p.requirements || p.gaps || [];
        let questions = [];
        if (category === "company") {
          const t = QUESTION_TEMPLATES.company(p.companyName || "this company");
          questions.push({ text: t.text, answerOutline: t.answerOutline, requirementIds: [] });
        } else {
          const make = QUESTION_TEMPLATES[category] || QUESTION_TEMPLATES.other;
          for (const req of requirements) {
            if (questions.length >= 8) break;
            const t = make(req);
            questions.push({ text: t.text, answerOutline: t.answerOutline, requirementIds: [req.id] });
            if (req.priority === "must" && questions.length < 8) {
              questions.push({
                text: `${t.text} Now make it harder: ${trunc(req.text, 60)} under a constraint or a deadline.`,
                answerOutline: t.answerOutline + " Consider the constraint explicitly.",
                requirementIds: [req.id],
              });
            }
          }
        }
        return json({ questions });
      }

      if (step === "flashcards") {
        const cards = [];
        for (const q of p.questions || []) {
          if (cards.length >= 10) break;
          cards.push({
            front: trunc(q.text, 90),
            back: trunc(q.answerOutline || "Review your answer outline for this question.", 200),
            requirementIds: q.requirementIds || [],
          });
        }
        if (cards.length < 6) {
          cards.push({
            front: `${p.companyName || "The company"}: what does it do in one line?`,
            back: trunc(p.companyFacts || "See the company brief.", 160),
            requirementIds: [],
          });
        }
        return json({ flashcards: cards });
      }

      if (step === "brief") {
        const missing = [];
        if (!p.hiringSummary) missing.push("no hiring-process page was retrievable");
        if (!p.discussionSummary) missing.push("no public discussion was found");
        const honesty = missing.length ? ` Note: ${missing.join(" and ")}.` : "";
        return json({
          brief: `${p.companyName} (${p.companyUrl}) - ${trunc(p.aboutSummary || "No summary retrievable.", 320)}.${honesty}`,
        });
      }

      if (step === "rolesummary" || step === "roleSummary") {
        const musts = (p.requirements || []).filter((r) => r.priority === "must").length;
        const nices = (p.requirements || []).filter((r) => r.priority === "nice").length;
        const thin = p.thinDescription ? " The posting is thin, so this breakdown stays deliberately brief." : "";
        return json({
          summary: `Role breakdown for "${p.title || "the posting"}": the description centres on ${musts} must-have ${musts === 1 ? "theme" : "themes"} and ${nices} nice-to-have${nices === 1 ? "" : "s"}.${thin}`,
        });
      }

      throw new Error(`mock provider: unknown step "${step}"`);
    },
  };
}