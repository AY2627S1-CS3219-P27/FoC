import type { AdminErrand } from "../_errands/types";

export interface DisputeSummary extends AdminErrand {
  reports: { requester: boolean; courier: boolean };
}

export interface DisputeReport {
  authorId: string;
  role: "requester" | "courier";
  body: string;
  createdAt: string;
}

export interface DisputeEvent {
  sequenceNumber: number;
  type: string;
  fromStatus: string | null;
  toStatus: string;
  payload: Record<string, unknown> | null;
  actorId: string | null;
  occurredAt: string;
}

export interface DisputeDetailData {
  errand: AdminErrand;
  reports: DisputeReport[];
  events: DisputeEvent[];
  latestRejection: DisputeEvent | null;
}

// Mirrors the backend's note cap (100 words) and report cap (2,000 characters).
export const MAX_NOTE_WORDS = 100;
export const MAX_REPORT_LENGTH = 2000;
export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
