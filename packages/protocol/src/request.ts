export const REQUEST_STATES = [
  "PENDING",
  "QUEUED",
  "SUBMITTED",
  "PROCESSING",
  "READY",
  "FAILED",
] as const;

export type RequestState = (typeof REQUEST_STATES)[number];