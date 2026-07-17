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
