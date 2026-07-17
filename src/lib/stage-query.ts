export type StageStatusFilter = "candidate" | "shortlisted" | "watchlist" | "snoozed" | "rejected" | "all" | null;
export type StageSeedFilter = boolean | null;

export interface StageClause {
  sql: string;
  bindings: Array<string | number>;
}

export function shortlistStageClause(
  statusFilter: StageStatusFilter,
  seedFilter: StageSeedFilter,
): StageClause {
  const clauses: string[] = [];
  const bindings: Array<string | number> = [];

  if (statusFilter === null) {
    clauses.push("c.status IN ('candidate', 'shortlisted', 'watchlist', 'snoozed')");
  } else if (statusFilter !== "all") {
    clauses.push("c.status = ?");
    bindings.push(statusFilter);
  }

  // Explicit pipeline views are exclusive routes. Outreach and currently
  // active relationships must never fall through into prospect tabs.
  if (statusFilter !== "all") {
    clauses.push("c.outreach_stage = 'none'");
    clauses.push("c.is_active = 0");
  }

  if (seedFilter !== null) {
    clauses.push("c.is_seed = ?");
    bindings.push(seedFilter ? 1 : 0);
  }

  return {
    sql: clauses.length > 0 ? clauses.map((clause) => `(${clause})`).join(" AND ") : "1 = 1",
    bindings,
  };
}
