import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export function findApprovedLoan(db: QueryCtx["db"], toolId: Id<"tools">) {
  return db
    .query("borrowRequests")
    .withIndex("by_tool_status", (q) =>
      q.eq("toolId", toolId).eq("status", "approved"),
    )
    .first();
}
