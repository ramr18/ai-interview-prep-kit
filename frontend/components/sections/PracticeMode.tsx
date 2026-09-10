"use client";

import { useEffect, useState, useCallback } from "react";
import { api, Kit, Flashcard } from "../../lib/api";

export function PracticeMode({ kit, onUpdate }: { kit: Kit; onUpdate: (k: Kit) => void }) {
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [stats, setStats] = useState({ total: 0, reviewed: 0, averageConfidence: 0 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const s = await api.getSession(kit.id);
      setCards(s.cards);
      setStats({ total: s.total, reviewed: s.reviewed, averageConfidence: s.averageConfidence });
    } finally { setLoading(false); }
  }, [kit.id]);

  useEffect(() => { load(); }, [load]);

  const rate = async (confidence: number) => {
    if (!cards[idx]) return;
    const { kit: updated } = await api.rateFlashcard(kit.id, cards[idx].id, confidence);
    onUpdate(updated);
    setRevealed(false);
    setIdx((i) => Math.min(i + 1, cards.length - 1));
    // Refresh stats
    const s = await api.getSession(kit.id);
    setStats({ total: s.total, reviewed: s.reviewed, averageConfidence: s.averageConfidence });
  };

  if (loading) return <div className="card text-sm text-slate-500">Loading…</div>;
  if (cards.length === 0) return <div className="card text-sm text-slate-500">No flashcards to practice.</div>;

  const card = cards[idx];
  const progress = ((idx + 1) / cards.length) * 100;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Practice mode</h2>
        <div className="text-sm text-slate-500">
          {stats.reviewed}/{stats.total} reviewed · avg confidence {stats.averageConfidence.toFixed(1)}/5
        </div>
      </div>

      <div className="h-2 rounded-full bg-slate-200">
        <div className="h-2 rounded-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
      </div>

      <div className="card min-h-[200px] flex flex-col">
        <p className="text-sm font-medium text-slate-500">Card {idx + 1} of {cards.length}</p>
        <p className="mt-4 text-lg font-medium">{card.front}</p>
        {revealed ? (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="text-sm text-slate-600">{card.back}</p>
            <div className="mt-6">
              <p className="mb-2 text-sm font-medium">How confident did you feel?</p>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} onClick={() => rate(n)} className="btn-secondary min-w-[60px] text-sm">
                    {n} {n <= 2 ? "😟" : n <= 3 ? "😐" : "😊"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <button onClick={() => setRevealed(true)} className="btn-primary mt-auto self-start">Reveal answer</button>
        )}
      </div>

      <p className="text-xs text-slate-400">Cards are shown in order of lowest confidence first, so you focus on weak spots.</p>
    </div>
  );
}
