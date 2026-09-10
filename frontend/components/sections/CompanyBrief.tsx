"use client";

import { useState } from "react";
import { api, Kit } from "../../lib/api";

export function CompanyBrief({ kit, onUpdate }: { kit: Kit; onUpdate: (k: Kit) => void }) {
  const [editing, setEditing] = useState(false);
  const [brief, setBrief] = useState(kit.company?.brief || "");
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const { kit: updated } = await api.editBrief(kit.id, brief);
      onUpdate(updated);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const { kit: updated } = await api.regenerate(kit.id, "brief");
      onUpdate(updated);
      setBrief(updated.company?.brief || "");
    } finally {
      setRegenerating(false);
    }
  };

  const isProtected = kit.company?.briefState === "edited";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Company brief</h2>
        <div className="flex gap-2">
          <button onClick={regenerate} disabled={regenerating} className="btn-secondary text-sm">
            {regenerating ? "Regenerating…" : "Regenerate"}
          </button>
          {!editing && (
            <button onClick={() => setEditing(true)} className="btn-ghost text-sm">Edit</button>
          )}
        </div>
      </div>

      {isProtected && !editing && (
        <p className="text-xs text-amber-600">You edited this section. Regeneration will preserve your edits.</p>
      )}

      {editing ? (
        <div className="space-y-2">
          <textarea
            className="input min-h-[120px] font-mono text-xs"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
          />
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="btn-primary text-sm">Save</button>
            <button onClick={() => { setEditing(false); setBrief(kit.company?.brief || ""); }} className="btn-ghost text-sm">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="card">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{kit.company?.brief || "No brief available."}</p>
        </div>
      )}

      {kit.company?.hiringProcess?.found && (
        <div className="card">
          <h3 className="mb-2 text-sm font-semibold">Hiring process</h3>
          <p className="text-sm text-slate-600">{kit.company.hiringProcess.summary}</p>
          {kit.company.hiringProcess.stages?.length > 0 && (
            <ol className="mt-3 space-y-2">
              {kit.company.hiringProcess.stages.map((s, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="font-medium text-blue-600">{i + 1}.</span>
                  <div>
                    <p className="font-medium">{s.name}</p>
                    {s.description && <p className="text-slate-500">{s.description}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {kit.notes?.noHiringPage && (
        <p className="text-xs text-amber-600">No hiring-process page was found on the company site.</p>
      )}

      {kit.sources && kit.sources.length > 0 && (
        <div className="card">
          <h3 className="mb-2 text-sm font-semibold">Sources</h3>
          <ul className="space-y-1">
            {kit.sources.map((s, i) => (
              <li key={i} className="text-xs">
                {s.skipped ? (
                  <span className="text-slate-400">⚠ {s.url} — {s.reason || "skipped"}</span>
                ) : (
                  <a href={s.url} target="_blank" rel="noopener" className="text-blue-600 hover:underline">
                    {s.title || s.url}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
