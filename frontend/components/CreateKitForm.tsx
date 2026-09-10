"use client";

import { useState, useRef } from "react";
import { api } from "../lib/api";

export function CreateKitForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [jd, setJd] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [days, setDays] = useState(7);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatus("submitting");
    setProgress([]);

    try {
      const { id } = await api.createKit(jd, companyUrl, days);
      setStatus("streaming");
      await streamProgress(id);
      onCreated(id);
    } catch (e: unknown) {
      setStatus("error");
      setProgress((p) => [...p, `Error: ${e instanceof Error ? e.message : "Failed to create kit"}`]);
    } finally {
      setBusy(false);
    }
  };

  const streamProgress = (id: string) =>
    new Promise<void>((resolve, reject) => {
      const base = process.env.NEXT_PUBLIC_API_BASE || "";
      const es = new EventSource(`${base}/api/kits/${id}/stream`, { withCredentials: true });

      es.addEventListener("phase", (evt) => {
        try {
          const data = JSON.parse((evt as MessageEvent).data);
          const label = [data.name, data.status, data.detail].filter(Boolean).join(" ");
          setProgress((p) => [...p, label]);
        } catch { /* ignore */ }
      });

      es.addEventListener("kit", (evt) => {
        try {
          const data = JSON.parse((evt as MessageEvent).data);
          if (data.status === "failed" || data.status === "partial") {
            setProgress((p) => [...p, `Kit finished with status: ${data.status}`]);
          }
        } catch { /* ignore */ }
      });

      es.addEventListener("done", (evt) => {
        es.close();
        try {
          const data = JSON.parse((evt as MessageEvent).data);
          if (data?.ok) resolve();
          else reject(new Error(data?.error?.message || "Generation failed"));
        } catch {
          resolve();
        }
      });

      es.onerror = () => {
        es.close();
        resolve();
      };
    });

  return (
    <div className="card sticky top-6">
      <h2 className="mb-3 text-lg font-semibold">New kit</h2>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="companyUrl">Company website</label>
          <input
            id="companyUrl"
            className="input"
            placeholder="https://example.com"
            value={companyUrl}
            onChange={(e) => setCompanyUrl(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="days">Days until interview</label>
          <input
            id="days"
            type="number"
            min={1}
            max={60}
            className="input"
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10) || 1)}
          />
        </div>
        <div>
          <label className="label" htmlFor="jd">Job description</label>
          <textarea
            id="jd"
            rows={8}
            className="input font-mono text-xs"
            placeholder="Paste the full job description here…"
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            required
          />
        </div>
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? "Generating…" : "Generate kit"}
        </button>
      </form>

      {status && progress.length > 0 && (
        <div className="mt-4 rounded-lg bg-slate-50 p-3">
          <p className="mb-1 text-xs font-medium text-slate-500">
            {status === "streaming" ? "Researching & generating…" : status === "error" ? "Failed" : "Status"}
          </p>
          <ul className="space-y-0.5">
            {progress.slice(-6).map((line, i) => (
              <li key={i} className="text-xs text-slate-600">{line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
