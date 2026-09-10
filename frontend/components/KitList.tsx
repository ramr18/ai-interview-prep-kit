"use client";

import { useEffect, useState } from "react";
import { api, Kit } from "../lib/api";

export function KitList({ onSelect }: { onSelect: (id: string) => void }) {
  const [kits, setKits] = useState<Kit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listKits()
      .then(({ kits }) => setKits(kits))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="card text-sm text-slate-500">Loading your kits…</div>;
  if (error) return <div className="card text-sm text-red-600">{error}</div>;
  if (kits.length === 0) {
    return (
      <div className="card text-center text-sm text-slate-500">
        <p className="font-medium">No kits yet</p>
        <p className="mt-1">Paste a job description to generate your first interview prep kit.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Your kits</h2>
      {kits.map((kit) => (
        <KitCard key={kit.id} kit={kit} onSelect={onSelect} />
      ))}
    </div>
  );
}

function KitCard({ kit, onSelect }: { kit: Kit; onSelect: (id: string) => void }) {
  const [deleting, setDeleting] = useState(false);

  const del = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this kit?")) return;
    setDeleting(true);
    try {
      await api.deleteKit(kit.id);
      window.location.reload();
    } catch {
      setDeleting(false);
    }
  };

  const statusColor =
    kit.status === "complete" ? "bg-green-100 text-green-700" :
    kit.status === "partial" ? "bg-amber-100 text-amber-700" :
    kit.status === "failed" ? "bg-red-100 text-red-700" :
    "bg-slate-100 text-slate-600";

  return (
    <button
      onClick={() => onSelect(kit.id)}
      className="card w-full text-left transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{kit.company?.name || kit.input?.companyUrl || "Untitled kit"}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {kit.role?.requirements?.length || 0} requirements · {kit.questions?.length || 0} questions · {kit.input?.days || 0} days
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${statusColor}`}>{kit.status}</span>
          <button onClick={del} disabled={deleting} className="text-slate-400 hover:text-red-600" title="Delete">
            ✕
          </button>
        </div>
      </div>
    </button>
  );
}
