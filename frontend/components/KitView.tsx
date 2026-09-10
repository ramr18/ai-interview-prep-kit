"use client";

import { useEffect, useState, useCallback } from "react";
import { api, Kit } from "../lib/api";
import { CompanyBrief } from "./sections/CompanyBrief";
import { RoleBreakdown } from "./sections/RoleBreakdown";
import { QuestionBank } from "./sections/QuestionBank";
import { Flashcards } from "./sections/Flashcards";
import { Schedule } from "./sections/Schedule";
import { PracticeMode } from "./sections/PracticeMode";

const TABS = ["Brief", "Role", "Questions", "Flashcards", "Schedule", "Practice"] as const;
type Tab = (typeof TABS)[number];

export function KitView({ kitId, onBack }: { kitId: string; onBack: () => void }) {
  const [kit, setKit] = useState<Kit | null>(null);
  const [tab, setTab] = useState<Tab>("Brief");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { kit } = await api.getKit(kitId);
      setKit(kit);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load kit");
    } finally {
      setLoading(false);
    }
  }, [kitId]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while the kit is still being generated.
  useEffect(() => {
    if (kit && (kit.status === "draft")) {
      const t = setInterval(load, 3000);
      return () => clearInterval(t);
    }
  }, [kit?.status, load]);

  if (loading) return <div className="card text-sm text-slate-500">Loading kit…</div>;
  if (error) return <div className="card text-sm text-red-600">{error}</div>;
  if (!kit) return null;

  return (
    <div>
      <button onClick={onBack} className="mb-4 btn-ghost text-sm">← Back to kits</button>

      {kit.status === "draft" ? (
        <GenerationProgress kit={kit} />
      ) : kit.status === "failed" ? (
        <div className="card text-red-600">
          <p className="font-medium">Generation failed</p>
          {kit.validationErrors?.map((e, i) => <p key={i} className="mt-1 text-sm">{e}</p>)}
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${tab === t ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-500 hover:text-slate-700"}`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="min-h-[400px]">
            {tab === "Brief" && <CompanyBrief kit={kit} onUpdate={setKit} />}
            {tab === "Role" && <RoleBreakdown kit={kit} onUpdate={setKit} />}
            {tab === "Questions" && <QuestionBank kit={kit} onUpdate={setKit} />}
            {tab === "Flashcards" && <Flashcards kit={kit} onUpdate={setKit} />}
            {tab === "Schedule" && <Schedule kit={kit} onUpdate={setKit} />}
            {tab === "Practice" && <PracticeMode kit={kit} onUpdate={setKit} />}
          </div>
        </>
      )}
    </div>
  );
}

function GenerationProgress({ kit }: { kit: Kit }) {
  return (
    <div className="card">
      <div className="flex items-center gap-3">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        <p className="font-medium">Generating your kit…</p>
      </div>
      <p className="mt-2 text-sm text-slate-500">
        Researching {kit.input?.companyUrl} and building your preparation kit. This takes about 10-30 seconds.
      </p>
      {kit.notes?.message && <p className="mt-2 text-sm text-amber-600">{kit.notes.message}</p>}
    </div>
  );
}
