"use client";

import { useState } from "react";
import { api, Flashcard, Kit } from "../../lib/api";

export function Flashcards({ kit, onUpdate }: { kit: Kit; onUpdate: (k: Kit) => void }) {
  const [adding, setAdding] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [busy, setBusy] = useState(false);

  const cards = kit.flashcards || [];

  const addCard = async (f: { front: string; back: string; requirementIds: string[] }) => {
    setBusy(true);
    try { const { kit: updated } = await api.addFlashcard(kit.id, f); onUpdate(updated); setAdding(false); }
    finally { setBusy(false); }
  };

  const deleteCard = async (id: string) => {
    setBusy(true);
    try { const { kit: updated } = await api.deleteFlashcard(kit.id, id); onUpdate(updated); }
    finally { setBusy(false); }
  };

  const regenerate = async () => {
    setRegenerating(true);
    try { const { kit: updated } = await api.regenerate(kit.id, "flashcards"); onUpdate(updated); }
    finally { setRegenerating(false); }
  };

  const editCard = async (card: Partial<Flashcard>) => {
    setBusy(true);
    try { const { kit: updated } = await api.editFlashcard(kit.id, card); onUpdate(updated); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Flashcards ({cards.length})</h2>
        <div className="flex gap-2">
          <button onClick={regenerate} disabled={regenerating} className="btn-secondary text-sm">{regenerating ? "Regenerating…" : "Regenerate"}</button>
          <button onClick={() => setAdding(true)} className="btn-primary text-sm">+ Add card</button>
        </div>
      </div>

      {adding && <AddCardForm onAdd={addCard} onCancel={() => setAdding(false)} />}

      {cards.length === 0 ? (
        <div className="card text-sm text-slate-500">No flashcards yet.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {cards.map((card) => (
            <FlashcardCard key={card.id} card={card} busy={busy} onEdit={editCard} onDelete={() => deleteCard(card.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function FlashcardCard({ card, busy, onEdit, onDelete }: { card: Flashcard; busy: boolean; onEdit: (card: Partial<Flashcard>) => void; onDelete: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const stateColor = card.state === "edited" ? "bg-amber-100 text-amber-700" : card.state === "created" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500";

  if (editing) {
    return (
      <div className="card space-y-2">
        <input className="input text-sm" value={front} onChange={(e) => setFront(e.target.value)} />
        <textarea className="input text-sm" value={back} onChange={(e) => setBack(e.target.value)} />
        <div className="flex gap-2">
          <button onClick={() => { onEdit({ id: card.id, front, back }); setEditing(false); }} disabled={busy || !front.trim() || !back.trim()} className="btn-primary text-sm">Save</button>
          <button onClick={() => setEditing(false)} className="btn-ghost text-sm">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card group relative">
      <button onClick={() => setRevealed(!revealed)} className="w-full text-left focus:outline-none" aria-label={revealed ? "Hide answer" : "Reveal answer"}>
        <p className="text-sm font-medium">{card.front}</p>
        {revealed ? (
          <p className="mt-2 text-sm text-slate-600 border-t border-slate-100 pt-2">{card.back}</p>
        ) : (
          <p className="mt-2 text-xs text-blue-600">Click to reveal answer</p>
        )}
      </button>
      <div className="absolute top-2 right-2 flex gap-1">
        <span className={`badge ${stateColor}`}>{card.state}</span>
        <button onClick={() => setEditing(true)} className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-blue-600 text-xs">Edit</button>
        <button onClick={onDelete} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-600 text-xs">✕</button>
      </div>
    </div>
  );
}

function AddCardForm({ onAdd, onCancel }: { onAdd: (f: { front: string; back: string; requirementIds: string[] }) => void; onCancel: () => void }) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  return (
    <div className="card space-y-2 border-blue-200 bg-blue-50">
      <input className="input text-sm" placeholder="Front (question)" value={front} onChange={(e) => setFront(e.target.value)} />
      <textarea className="input text-sm" placeholder="Back (answer)" value={back} onChange={(e) => setBack(e.target.value)} />
      <div className="flex gap-2">
        <button onClick={() => onAdd({ front, back, requirementIds: [] })} disabled={!front || !back} className="btn-primary text-sm">Add</button>
        <button onClick={onCancel} className="btn-ghost text-sm">Cancel</button>
      </div>
    </div>
  );
}
