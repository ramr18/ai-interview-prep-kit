"use client";

import { useState } from "react";
import { useAuth } from "../lib/auth";
import { AuthForm } from "../components/AuthForm";
import { KitList } from "../components/KitList";
import { CreateKitForm } from "../components/CreateKitForm";
import { KitView } from "../components/KitView";
import { Kit } from "../lib/api";

export default function Home() {
  const { user, loading } = useAuth();
  const [activeKitId, setActiveKitId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-slate-500">Loading…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold text-ink">PrepKit</h1>
            <p className="mt-2 text-slate-600">Turn a job description into a personalised interview preparation kit.</p>
          </div>
          <AuthForm />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <h1 className="text-xl font-bold text-ink">PrepKit</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">{user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {activeKitId ? (
          <KitView kitId={activeKitId} onBack={() => { setActiveKitId(null); setRefreshKey((k) => k + 1); }} />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
            <CreateKitForm onCreated={(id) => setActiveKitId(id)} />
            <KitList key={refreshKey} onSelect={setActiveKitId} />
          </div>
        )}
      </main>
    </div>
  );
}

function LogoutButton() {
  const { logout } = useAuth();
  return (
    <button
      onClick={() => logout()}
      className="btn-ghost text-sm"
    >
      Sign out
    </button>
  );
}
