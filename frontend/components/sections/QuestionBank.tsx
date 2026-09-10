"use client";

import { useState, useMemo } from "react";
import { api, Kit, Question } from "../../lib/api";

const CATEGORIES = ["technical", "behavioural", "product", "process", "company", "other"] as const;

export function QuestionBank({ kit, onUpdate }: { kit: Kit; onUpdate: (k: Kit) => void }) {
  const [activeCat, setActiveCat] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const questions = kit.questions || [];
  const categories = useMemo(() => {
    const set = new Set(questions.map((q) => q.category));
    return ["all", ...Array.from(set)];
  }, [questions]);

  const filtered = activeCat === "all" ? questions : questions.filter((q) => q.category === activeCat);

  const saveEdit = async (q: Question) => {
    setBusy(true);
    try { const { kit: updated } = await api.editQuestion(kit.id, q); onUpdate(updated); setEditingId(null); }
    finally { setBusy(false); }
  };

  const deleteQuestion = async (id: string) => {
    setBusy(true);
    try { const { kit: updated } = await api.deleteQuestion(kit.id, id); onUpdate(updated); }
    finally { setBusy(false); }
  };

  const addQuestion = async (q: { text: string; category: string; requirementIds: string[]; answerOutline: string }) => {
    setBusy(true);
    try { const { kit: updated } = await api.addQuestion(kit.id, q); onUpdate(updated); setAdding(false); }
    finally { setBusy(false); }
  };

  const regenerateCategory = async (category: string) => {
    setRegenerating(category);
    try { const { kit: updated } = await api.regenerate(kit.id, "questions", { category }); onUpdate(updated); }
    finally { setRegenerating(null); }
  };

  const moveQuestion = async (idx: number, dir: -1 | 1) => {
    const newList = [...filtered];
    const [item] = newList.splice(idx, 1);
    newList.splice(idx + dir, 0, item);
    const reordered = activeCat === "all"
      ? newList
      : (() => {
          let nextIndex = 0;
          return questions.map((question) => question.category === activeCat ? newList[nextIndex++] : question);
        })();
    const allIds = reordered.map((q) => q.id);
    setBusy(true);
    try { const { kit: updated } = await api.reorderQuestions(kit.id, allIds); onUpdate(updated); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Question bank ({questions.length})</h2>
        <button onClick={() => setAdding(true)} className="btn-primary text-sm">+ Add question</button>
      </div>
      <div className="flex flex-wrap gap-1">
        {categories.map((c) => (
          <button key={c} onClick={() => setActiveCat(c)} className={`rounded-full px-3 py-1 text-xs font-medium ${activeCat === c ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{c}</button>
        ))}
      </div>
      {adding && <AddQuestionForm onAdd={addQuestion} onCancel={() => setAdding(false)} requirements={kit.role?.requirements || []} />}
      <div className="space-y-2">
        {filtered.map((q, idx) => (
          <QuestionCard key={q.id} question={q} editing={editingId === q.id} busy={busy} onEdit={() => setEditingId(q.id)} onSave={saveEdit} onCancel={() => setEditingId(null)} onDelete={() => deleteQuestion(q.id)} onMoveUp={() => moveQuestion(idx, -1)} onMoveDown={() => moveQuestion(idx, 1)} canMoveUp={idx > 0} canMoveDown={idx < filtered.length - 1} />
        ))}
      </div>
      {activeCat !== "all" && (
        <button onClick={() => regenerateCategory(activeCat)} disabled={regenerating === activeCat} className="btn-secondary text-sm">
          {regenerating === activeCat ? "Regenerating…" : `Regenerate ${activeCat} questions`}
        </button>
      )}
    </div>
  );
}

function QuestionCard({ question, editing, busy, onEdit, onSave, onCancel, onDelete, onMoveUp, onMoveDown, canMoveUp, canMoveDown }: { question: Question; editing: boolean; busy: boolean; onEdit: () => void; onSave: (q: Question) => void; onCancel: () => void; onDelete: () => void; onMoveUp: () => void; onMoveDown: () => void; canMoveUp: boolean; canMoveDown: boolean }) {
  const [draft, setDraft] = useState(question);
  if (editing) {
    return (
      <div className="card space-y-2">
        <textarea className="input font-mono text-xs" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
        <textarea className="input font-mono text-xs" placeholder="Answer outline" value={draft.answerOutline} onChange={(e) => setDraft({ ...draft, answerOutline: e.target.value })} />
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-auto text-sm" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="flex gap-2 ml-auto">
            <button onClick={() => onSave(draft)} disabled={busy} className="btn-primary text-sm">Save</button>
            <button onClick={onCancel} className="btn-ghost text-sm">Cancel</button>
          </div>
        </div>
      </div>
    );
  }
  const stateColor = question.state === "edited" ? "bg-amber-100 text-amber-700" : question.state === "created" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500";
  return (
    <div className="card group">
      <div className="flex items-start justify-between gap-2">
        <p className="flex-1 text-sm font-medium">{question.text}</p>
        <span className={`badge ${stateColor}`}>{question.state}</span>
      </div>
      {question.answerOutline && <p className="mt-1 text-xs text-slate-500">{question.answerOutline}</p>}
      <div className="mt-2 flex items-center gap-2">
        <span className="badge bg-blue-50 text-blue-600">{question.category}</span>
        <div className="ml-auto flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button onClick={onMoveUp} disabled={!canMoveUp} className="btn-ghost px-2 py-1 text-xs">↑</button>
          <button onClick={onMoveDown} disabled={!canMoveDown} className="btn-ghost px-2 py-1 text-xs">↓</button>
          <button onClick={onEdit} className="btn-ghost px-2 py-1 text-xs">Edit</button>
          <button onClick={onDelete} className="btn-ghost px-2 py-1 text-xs text-red-600">Delete</button>
        </div>
      </div>
    </div>
  );
}

function AddQuestionForm({ onAdd, onCancel, requirements }: { onAdd: (q: { text: string; category: string; requirementIds: string[]; answerOutline: string }) => void; onCancel: () => void; requirements: { id: string; text: string }[] }) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState("technical");
  const [answerOutline, setAnswerOutline] = useState("");
  const [reqIds, setReqIds] = useState<string[]>([]);
  return (
    <div className="card space-y-2 border-blue-200 bg-blue-50">
      <textarea className="input font-mono text-xs" placeholder="Question text" value={text} onChange={(e) => setText(e.target.value)} />
      <textarea className="input font-mono text-xs" placeholder="Answer outline (optional)" value={answerOutline} onChange={(e) => setAnswerOutline(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <select className="input w-auto text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select className="input w-auto text-sm" onChange={(e) => { if (e.target.value) setReqIds([...reqIds, e.target.value]); }}>
          <option value="">Link requirement…</option>
          {requirements.map((r) => <option key={r.id} value={r.id}>{r.text.slice(0, 40)}</option>)}
        </select>
      </div>
      {reqIds.length > 0 && <div className="flex flex-wrap gap-1">{reqIds.map((id) => <button key={id} onClick={() => setReqIds(reqIds.filter((x) => x !== id))} className="badge bg-blue-100 text-blue-700 hover:bg-blue-200">{id} ✕</button>)}</div>}
      <div className="flex gap-2">
        <button onClick={() => onAdd({ text, category, answerOutline, requirementIds: reqIds })} disabled={!text} className="btn-primary text-sm">Add</button>
        <button onClick={onCancel} className="btn-ghost text-sm">Cancel</button>
      </div>
    </div>
  );
}
