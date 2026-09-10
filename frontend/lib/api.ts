"use client";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Request failed: ${res.status}`);
  }
  return data as T;
}

export interface User {
  id: string;
  email: string;
  createdAt?: string;
}

export interface Requirement {
  id: string;
  text: string;
  priority: "must" | "nice";
  category: string;
}

export interface Question {
  id: string;
  category: string;
  requirementIds: string[];
  text: string;
  answerOutline: string;
  state: "generated" | "edited" | "created" | "pinned";
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  requirementIds: string[];
  state: string;
  practice: { confidence: number; reviewCount: number; lastReviewedAt?: string };
}

export interface ScheduleDay {
  day: number;
  focus: string;
  questionIds: string[];
  requirementIds: string[];
  durationMinutes: number;
}

export interface Kit {
  id: string;
  status: "draft" | "complete" | "partial" | "failed";
  createdAt: string;
  updatedAt: string;
  input: { jd: string; companyUrl: string; days: number; jdHash?: string };
  company: {
    name: string;
    website: string;
    brief: string;
    briefState: string;
    hiringProcess: { found: boolean; summary: string; stages: { name: string; description: string }[] };
  };
  role: {
    title: string;
    summary: string;
    summaryState: string;
    requirements: Requirement[];
  };
  questions: Question[];
  flashcards: Flashcard[];
  schedule: ScheduleDay[];
  notes: { thinDescription?: boolean; noHiringPage?: boolean; noDiscussion?: boolean; message?: string };
  gaps: { requirementId: string; text: string }[];
  valid: boolean;
  validationErrors: string[];
  sources: { url: string; kind: string; title?: string; skipped?: boolean; reason?: string }[];
  research?: {
    aboutSummary?: string;
    whatTheyDo?: string;
    values?: string[];
    hiringSummary?: string;
    discussionSummary?: string;
    discussionThemes?: string[];
  };
}

export const api = {
  // auth
  me: () => request<{ user: User | null }>("/api/auth/me"),
  register: (email: string, password: string) =>
    request<{ user: User }>("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    request<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  // kits
  listKits: () => request<{ kits: Kit[] }>("/api/kits"),
  getKit: (id: string) => request<{ kit: Kit }>(`/api/kits/${id}`),
  createKit: (jd: string, companyUrl: string, days: number) =>
    request<{ id: string; status: string }>("/api/kits", { method: "POST", body: JSON.stringify({ jd, companyUrl, days }) }),
  deleteKit: (id: string) => request<{ ok: true }>(`/api/kits/${id}`, { method: "DELETE" }),

  // kit editing
  editQuestion: (kitId: string, q: Partial<Question>) =>
    request<{ kit: Kit }>(`/api/kits/${kitId}`, { method: "PATCH", body: JSON.stringify({ editQuestion: q }) }),
  editFlashcard: (kitId: string, f: Partial<Flashcard>) =>
    request<{ kit: Kit }>(`/api/kits/${kitId}`, { method: "PATCH", body: JSON.stringify({ editFlashcard: f }) }),
  editBrief: (kitId: string, brief: string) =>
    request<{ kit: Kit }>(`/api/kits/${kitId}`, { method: "PATCH", body: JSON.stringify({ brief }) }),
  editRoleSummary: (kitId: string, roleSummary: string) =>
    request<{ kit: Kit }>(`/api/kits/${kitId}`, { method: "PATCH", body: JSON.stringify({ roleSummary }) }),
  reorderQuestions: (kitId: string, ids: string[]) =>
    request<{ kit: Kit }>(`/api/kits/${kitId}`, { method: "PATCH", body: JSON.stringify({ reorderQuestions: ids }) }),
  addQuestion: (kitId: string, q: { text: string; category: string; requirementIds: string[]; answerOutline?: string }) =>
    request<{ kit: Kit }>(`/api/kits/${kitId}`, { method: "PATCH", body: JSON.stringify({ addQuestion: q }) }),
  deleteQuestion: (kitId: string, id: string) =>
    request<{ kit: Kit }>(`/api/kits/${kitId}`, { method: "PATCH", body: JSON.stringify({ deleteQuestionId: id }) }),
  addFlashcard: (kitId: string, f: { front: string; back: string; requirementIds: string[] }) =>
    request<{ kit: Kit }>(`/api/kits/${kitId}`, { method: "PATCH", body: JSON.stringify({ addFlashcard: f }) }),
  deleteFlashcard: (kitId: string, id: string) =>
    request<{ kit: Kit }>(`/api/kits/${kitId}`, { method: "PATCH", body: JSON.stringify({ deleteFlashcardId: id }) }),
  editDay: (kitId: string, day: Partial<ScheduleDay>) =>
    request<{ kit: Kit }>(`/api/kits/${kitId}`, { method: "PATCH", body: JSON.stringify({ editDay: day }) }),

  // regenerate
  regenerate: (kitId: string, section: string, extra?: Record<string, unknown>) =>
    request<{ kit: Kit }>(`/api/kits/${kitId}/regenerate/${section}`, { method: "POST", body: JSON.stringify(extra || {}) }),

  // practice
  rateFlashcard: (kitId: string, cardId: string, confidence: number) =>
    request<{ kit: Kit }>(`/api/practice/${kitId}/rate/${cardId}`, { method: "POST", body: JSON.stringify({ confidence }) }),
  getSession: (kitId: string) =>
    request<{ cards: Flashcard[]; total: number; reviewed: number; unreviewed: number; averageConfidence: number }>(`/api/practice/${kitId}/session`),
};
