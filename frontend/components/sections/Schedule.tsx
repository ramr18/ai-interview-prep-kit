"use client";

import { useState } from "react";
import { api, Kit } from "../../lib/api";

export function Schedule({ kit, onUpdate }: { kit: Kit; onUpdate: (k: Kit) => void }) {
  const [regenerating, setRegenerating] = useState(false);
  const days = kit.schedule || [];
  const totalMins = days.reduce((a, d) => a + d.durationMinutes, 0);

  const regenerate = async () => {
    setRegenerating(true);
    try { const { kit: updated } = await api.regenerate(kit.id, "schedule"); onUpdate(updated); }
    finally { setRegenerating(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Study schedule</h2>
          <p className="text-sm text-slate-500">{days.length} days · {totalW(totalMins)}</p>
        </div>
        <button onClick={regenerate} disabled={regenerating} className="btn-secondary text-sm">{regenerating ? "Regenerating…" : "Regenerate"}</button>
      </div>

      {days.length === 0 ? (
        <div className="card text-sm text-slate-500">No schedule generated.</div>
      ) : (
        <div className="space-y-2">
          {days.map((d) => (
            <div key={d.day} className="card">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">{d.day}</div>
                  <div>
                    <p className="text-sm font-medium">{d.focus}</p>
                    <p className="text-xs text-slate-500">{d.questionIds.length} questions · {d.requirementIds.length} requirements</p>
                  </div>
                </div>
                <span className="badge bg-slate-100 text-slate-600">{d.durationMinutes} min</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function totalW(mins: number) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
