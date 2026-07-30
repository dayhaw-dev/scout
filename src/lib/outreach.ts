export const OUTREACH_STATUSES = [
  "none",
  "sent",
  "replied",
  "in_talks",
  "pitched",
  "signed",
  "passed",
] as const;

export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];
export type OutreachRoute = "pipeline" | "live" | "closed";
export type OutreachSection = "working" | "live" | "closed" | null;

export const CLOSE_DISPOSITIONS = ["declined", "no_reply"] as const;
export type CloseDisposition = (typeof CLOSE_DISPOSITIONS)[number];

export const OUTREACH_EVENT_TYPES = [
  "note",
  "stage_changed",
  "closed",
  "reopened",
  "trigger_dismissed",
] as const;
export type OutreachEventType = (typeof OUTREACH_EVENT_TYPES)[number];

export class OutreachValidationError extends Error {}

export interface OutreachStageEvent {
  eventType: OutreachEventType;
  fromStage: OutreachStatus | null;
  toStage: OutreachStatus | null;
  logCloseDisposition: CloseDisposition | null;
  channelCloseDisposition: CloseDisposition | null;
}

export function validateOutreachEventType(value: unknown): OutreachEventType {
  if (!OUTREACH_EVENT_TYPES.includes(value as OutreachEventType)) {
    throw new OutreachValidationError("Invalid outreach event_type");
  }
  return value as OutreachEventType;
}

export function planOutreachStageEvent(
  fromStage: OutreachStatus,
  toStage: OutreachStatus,
  requestedCloseDisposition: unknown,
): OutreachStageEvent {
  let channelCloseDisposition: CloseDisposition | null = null;
  if (toStage === "passed") {
    if (!CLOSE_DISPOSITIONS.includes(requestedCloseDisposition as CloseDisposition)) {
      throw new OutreachValidationError("close_disposition is required when outreach_status is passed");
    }
    channelCloseDisposition = requestedCloseDisposition as CloseDisposition;
  }

  const stageChanged = fromStage !== toStage;
  const eventType = validateOutreachEventType(
    stageChanged
      ? toStage === "passed" || toStage === "signed"
        ? "closed"
        : "stage_changed"
      : "note",
  );

  return {
    eventType,
    fromStage: stageChanged ? fromStage : null,
    toStage: stageChanged ? toStage : null,
    logCloseDisposition: stageChanged && toStage === "passed" ? channelCloseDisposition : null,
    channelCloseDisposition,
  };
}

export const LIVE_OUTREACH_STATUSES = [
  "sent",
  "replied",
  "in_talks",
  "pitched",
] as const satisfies readonly OutreachStatus[];

export const CLOSED_OUTREACH_STATUSES = [
  "signed",
  "passed",
] as const satisfies readonly OutreachStatus[];

export function outreachRoute(status: OutreachStatus): OutreachRoute {
  switch (status) {
    case "none":
      return "pipeline";
    case "sent":
    case "replied":
    case "in_talks":
    case "pitched":
      return "live";
    case "signed":
    case "passed":
      return "closed";
  }
}

export function outreachSection(
  status: OutreachStatus,
  isActive: boolean,
): OutreachSection {
  if (isActive) return "working";

  const route = outreachRoute(status);
  return route === "pipeline" ? null : route;
}

export function outreachSqlList(statuses: readonly OutreachStatus[]): string {
  return statuses.map((status) => `'${status}'`).join(", ");
}
