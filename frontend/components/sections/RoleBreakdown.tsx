"use client";

import { useState } from "react";
import { api, Kit } from "../../lib/api";

export function RoleBreakdown({ kit, onUpdate }: { kit: Kit; onUpdate: (k: Kit) => void }) {
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(kit.role?.summary || "");
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const { kit: updated } = await api.editRoleSummary(kit.id, summary);
      onUpdate(updated);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const { kit: updated } = await api.regenerate(kit.id, "roleSummary");
      onUpdate(updated);
      setSummary(updated.role?.summary || "");
    } finally {
      setRegenerating(false);
    }
  };

  const reqs = kit.role?.requirements || [];
  const musts = reqs.filter((r) => r.priority === "must");
  const nices = reqs.filter((r) => r.priority === "nice");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Role breakdown</h2>
        <div className="flex gap-2">
          <button onClick={regenerate} disabled={regenerating} className="btn-secondary text-sm">
            {regenerating ? "Regenerating…" : "Regenerate"}
          </button>
          {!editing && <button onClick={() => setEditing(true)} className="btn-ghost text-sm">Edit</button>}
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea className="input min-h-[80px] font-mono text-xs" value={summary} onChange={(e) => setSummary(e.target.value)} />
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="btn-primary text-sm">Save</button>
            <button onClick={() => { setEditing(false); setSummary(kit.role?.summary || ""); }} className="btn-ghost text-sm">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="card">
          <p className="text-sm leading-relaxed">{kit.role?.summary || "No summary available."}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card">
          <h3 className="mb-2 text-sm font-semibold text-red-600">Must-have ({musts.length})</h3>
          {musts.length === 0 ? (
            <p className="text-xs text-slate-400">None identified</p>
          ) : (
            <ul className="space-y-1.5">
              {musts.map((r) => (
                <li key={r.id} className="flex items-start gap-2 text-sm">
                  <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-400" />
                  <div>
                    <span>{r.text}</span>
                    <span className="ml-2 badge bg-slate-100 text-slate-500">{r.category}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <h3 className="mb-2 text-sm font-semibold text-blue-600">Nice-to-have ({nices.length})</h3>
          {nices.length === 0 ? (
            <p className="text-xs text-slate-400">None identified</p>
          ) : (
            <ul className="space-y-1.5">
              {nices.map((r) => (
                <li key={r.id} className="flex items-start gap-2 text-sm">
                  <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-400" />
                  <div>
                    <span>{r.text}</span>
                    <span className="ml-2 badge bg-slate-100 text-slate-500">{r.category}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {kit.notes?.thinDescription && (
        <p className="text-xs text-amber-600">
          The job description was thin — few requirements were extracted. The kit reflects what was actually in the posting.
        </p>
      )}

      {kit.gaps && kit.gaps.length > 0 && (
        <div className="card border-amber-200 bg-amber-50">
          <h3 className="mb-1 text-sm font-semibold text-amber-700">Uncovered requirements ({kit.gaps.length})</h3>
          <p className="text-xs text-amber-600">These must-have requirements had no question generated for them:</p>
          <ul className="mt-2 space-y-1">
            {kit.gaps.map((g) => (
              <li key={g.requirementId} className="text-xs text-amber-700">• {g.text}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
