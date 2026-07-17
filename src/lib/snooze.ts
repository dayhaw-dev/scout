export type SnoozeableStatus = "candidate" | "watchlist";

export interface SnoozeState {
  status: string;
  snoozed_until: string | null;
  snooze_reason: string | null;
  snoozed_at: string | null;
  snoozed_from_status: string | null;
  woke_at: string | null;
}

export interface SnoozePatch {
  status?: unknown;
  snoozed_until?: unknown;
  snooze_reason?: unknown;
}

export type SnoozeTransition =
  | { kind: "none" }
  | { kind: "snooze"; until: string; reason: string; fromStatus: SnoozeableStatus; preserveStartedAt: boolean }
  | { kind: "wake" }
  | { kind: "clear" };

export class SnoozeValidationError extends Error {}

export function planSnoozeTransition(
  existing: SnoozeState,
  patch: SnoozePatch,
  now = new Date(),
): SnoozeTransition {
  const touchesSnooze = patch.snoozed_until !== undefined || patch.snooze_reason !== undefined;
  const nextStatus = typeof patch.status === "string" ? patch.status : undefined;

  if (nextStatus === "snoozed" || (existing.status === "snoozed" && touchesSnooze && nextStatus === undefined)) {
    if (existing.status !== "snoozed" && existing.status !== "candidate" && existing.status !== "watchlist") {
      throw new SnoozeValidationError("Only Pool or Eyes Peeled channels can be snoozed.");
    }

    const reason = typeof patch.snooze_reason === "string" ? patch.snooze_reason.trim() : "";
    if (!reason) throw new SnoozeValidationError("snooze_reason is required.");
    if (reason.length > 240) throw new SnoozeValidationError("snooze_reason must be 240 characters or fewer.");

    const until = parseFutureTimestamp(patch.snoozed_until, now);
    return {
      kind: "snooze",
      until,
      reason,
      fromStatus: existing.status === "snoozed"
        ? normalizePriorStatus(existing.snoozed_from_status)
        : existing.status,
      preserveStartedAt: existing.status === "snoozed" && Boolean(existing.snoozed_at),
    };
  }

  if (touchesSnooze) {
    throw new SnoozeValidationError("Snooze fields can only be changed while snoozing a channel.");
  }

  if (existing.status === "snoozed" && nextStatus === "candidate") return { kind: "wake" };

  if (nextStatus !== undefined && nextStatus !== existing.status && hasSnoozeContext(existing)) {
    return { kind: "clear" };
  }

  return { kind: "none" };
}

function parseFutureTimestamp(value: unknown, now: Date): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new SnoozeValidationError("snoozed_until is required.");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new SnoozeValidationError("snoozed_until must be a valid timestamp.");
  }
  if (parsed.getTime() <= now.getTime()) {
    throw new SnoozeValidationError("snoozed_until must be in the future.");
  }
  return parsed.toISOString();
}

function normalizePriorStatus(value: string | null): SnoozeableStatus {
  return value === "watchlist" ? "watchlist" : "candidate";
}

function hasSnoozeContext(state: SnoozeState): boolean {
  return Boolean(
    state.snoozed_until ||
    state.snooze_reason ||
    state.snoozed_at ||
    state.snoozed_from_status ||
    state.woke_at,
  );
}
