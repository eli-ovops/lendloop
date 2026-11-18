import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { canManage, requireAdmin, requireUser } from "./lib/auth";
import { findApprovedLoan } from "./lib/loans";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function assertDateRange(startDate: string, endDate: string) {
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    throw new Error("Dates must use the YYYY-MM-DD format.");
  }
  if (startDate > endDate) {
    throw new Error("The start date must be on or before the return date.");
  }
  if (endDate < todayUtc()) {
    throw new Error("The return date cannot be in the past.");
  }
}

/** Attach display fields (tool name, borrower/owner names) to a request. */
async function enrich(
  ctx: QueryCtx,
  req: Doc<"borrowRequests">,
) {
  const [tool, borrower, owner] = await Promise.all([
    ctx.db.get(req.toolId),
    ctx.db.get(req.borrowerId),
    ctx.db.get(req.ownerId),
  ]);
  return {
    ...req,
    toolName: tool?.name ?? "(removed tool)",
    borrowerName: borrower?.name ?? "Neighbour",
    ownerName: owner?.name ?? "Neighbour",
  };
}

/**
 * Create a borrow request for a date range.
 * Rules enforced here (function layer, not UI):
 * - caller must be signed in;
 * - you cannot borrow your own tool;
 * - the tool must currently be marked available;
 * - no overlapping pending/approved request by the same borrower.
 * Side effect: schedules the n8n notification action (borrow-request
 * webhook). Scheduling from inside the mutation keeps the notification
 * atomic with the write — it cannot fire for a request that failed to save.
 */
export const request = mutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"borrowRequests">> => {
    const user = await requireUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) throw new Error("Tool not found.");
    if (tool.ownerId === user._id) {
      throw new Error("You cannot borrow your own tool.");
    }
    if (!tool.available || (await findApprovedLoan(ctx.db, tool._id))) {
      throw new Error("This tool is currently unavailable.");
    }
    assertDateRange(args.startDate, args.endDate);
    const note = args.note?.trim();
    if (note && note.length > 200) {
      throw new Error("Keep the borrow note to 200 characters or fewer.");
    }

    const mine = await ctx.db
      .query("borrowRequests")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", user._id))
      .filter((q) =>
        q.and(
          q.eq(q.field("toolId"), args.toolId),
          q.or(
            q.eq(q.field("status"), "pending"),
            q.eq(q.field("status"), "approved"),
          ),
        ),
      )
      .collect();
    const overlaps = mine.some(
      (r) => r.startDate <= args.endDate && args.startDate <= r.endDate,
    );
    if (overlaps) {
      throw new Error(
        "You already have a pending or approved request overlapping those dates.",
      );
    }

    const borrowRequestId = await ctx.db.insert("borrowRequests", {
      toolId: tool._id,
      borrowerId: user._id,
      ownerId: tool.ownerId,
      startDate: args.startDate,
      endDate: args.endDate,
      note: note || undefined,
      status: "pending",
      createdAt: Date.now(),
    });

    await ctx.scheduler.runAfter(
      0,
      internal.notifications.sendBorrowRequestNotification,
      { borrowRequestId },
    );

    return borrowRequestId;
  },
});

/** Requests I sent (as borrower). */
export const myOutgoing = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query("borrowRequests")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", user._id))
      .order("desc")
      .collect();
    return await Promise.all(rows.map((r) => enrich(ctx, r)));
  },
});

/** Requests for tools I own (as lender). */
export const myIncoming = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query("borrowRequests")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .collect();
    return await Promise.all(rows.map((r) => enrich(ctx, r)));
  },
});

async function loadRequest(ctx: QueryCtx, id: Id<"borrowRequests">) {
  const req = await ctx.db.get(id);
  if (!req) throw new Error("Borrow request not found.");
  return req;
}

/** Approve a pending request. Tool owner or admin only. */
export const approve = mutation({
  args: { requestId: v.id("borrowRequests") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const req = await loadRequest(ctx, args.requestId);
    if (!canManage(user, req.ownerId)) {
      throw new Error("Forbidden: only the tool owner or an admin can approve.");
    }
    if (req.status !== "pending") {
      throw new Error(`Cannot approve a request in status "${req.status}".`);
    }
    const tool = await ctx.db.get(req.toolId);
    if (!tool) throw new Error("Tool not found.");
    if (!tool.available || (await findApprovedLoan(ctx.db, tool._id))) {
      throw new Error(
        "This tool is unavailable. Return any active loan before approving another.",
      );
    }
    await ctx.db.patch(req._id, { status: "approved", decidedAt: Date.now() });
    // While a loan is out, the tool leaves the available pool.
    await ctx.db.patch(req.toolId, { available: false });
  },
});

/** Decline a pending request. Tool owner or admin only. */
export const decline = mutation({
  args: { requestId: v.id("borrowRequests") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const req = await loadRequest(ctx, args.requestId);
    if (!canManage(user, req.ownerId)) {
      throw new Error("Forbidden: only the tool owner or an admin can decline.");
    }
    if (req.status !== "pending") {
      throw new Error(`Cannot decline a request in status "${req.status}".`);
    }
    await ctx.db.patch(req._id, { status: "declined", decidedAt: Date.now() });
  },
});

/** Cancel my own pending request. Borrower only. */
export const cancel = mutation({
  args: { requestId: v.id("borrowRequests") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const req = await loadRequest(ctx, args.requestId);
    if (req.borrowerId !== user._id && user.role !== "admin") {
      throw new Error("Forbidden: only the borrower can cancel this request.");
    }
    if (req.status !== "pending") {
      throw new Error(`Cannot cancel a request in status "${req.status}".`);
    }
    await ctx.db.patch(req._id, { status: "cancelled" });
  },
});

/**
 * Mark an approved loan as returned. The owner (or an admin) confirms the
 * physical return — a borrower cannot unilaterally close a loan. Returning
 * puts the tool back into the available pool.
 */
export const markReturned = mutation({
  args: { requestId: v.id("borrowRequests") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const req = await loadRequest(ctx, args.requestId);
    if (!canManage(user, req.ownerId)) {
      throw new Error(
        "Forbidden: only the tool owner or an admin can confirm a return.",
      );
    }
    if (req.status !== "approved") {
      throw new Error(
        `Cannot mark returned a request in status "${req.status}".`,
      );
    }
    await ctx.db.patch(req._id, {
      status: "returned",
      returnedAt: Date.now(),
    });
    // Older versions could remove a tool or leave two approved loans.
    // Allow the return in both cases without relisting an outstanding loan.
    const tool = await ctx.db.get(req.toolId);
    if (tool) {
      const remainingLoan = await findApprovedLoan(ctx.db, tool._id);
      await ctx.db.patch(tool._id, { available: !remainingLoan });
    }
  },
});

/** Admin oversight: every request in the system. Admin role enforced. */
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("borrowRequests").order("desc").collect();
    return await Promise.all(rows.map((r) => enrich(ctx, r)));
  },
});

/* ------------------------------------------------------------------ */
/* Internal helpers used by the notification action and HTTP endpoints */
/* ------------------------------------------------------------------ */

/** Full detail for the outbound n8n notification payload. */
export const getDetail = internalQuery({
  args: { borrowRequestId: v.id("borrowRequests") },
  handler: async (ctx, args) => {
    const req = await ctx.db.get(args.borrowRequestId);
    if (!req) return null;
    const [tool, borrower, owner] = await Promise.all([
      ctx.db.get(req.toolId),
      ctx.db.get(req.borrowerId),
      ctx.db.get(req.ownerId),
    ]);
    return {
      borrowRequestId: req._id,
      status: req.status,
      startDate: req.startDate,
      endDate: req.endDate,
      note: req.note ?? null,
      createdAt: req.createdAt,
      tool: tool
        ? { id: tool._id, name: tool.name, category: tool.category }
        : null,
      borrower: borrower
        ? { name: borrower.name, email: borrower.email }
        : null,
      owner: owner ? { name: owner.name, email: owner.email } : null,
    };
  },
});

/**
 * Loans that are out past their return-by date. Consumed by the daily n8n
 * overdue-reminder workflow through the signed HTTP endpoint.
 */
export const getOverdue = internalQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayUtc();
    const approved = await ctx.db
      .query("borrowRequests")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();
    const overdue = approved.filter((r) => r.endDate < today);
    return await Promise.all(
      overdue.map(async (r) => {
        const [tool, borrower, owner] = await Promise.all([
          ctx.db.get(r.toolId),
          ctx.db.get(r.borrowerId),
          ctx.db.get(r.ownerId),
        ]);
        const daysOverdue = Math.floor(
          (Date.parse(today) - Date.parse(r.endDate)) / 86_400_000,
        );
        return {
          borrowRequestId: r._id,
          toolName: tool?.name ?? "(removed tool)",
          borrowerName: borrower?.name ?? "Neighbour",
          borrowerEmail: borrower?.email ?? "",
          ownerName: owner?.name ?? "Neighbour",
          ownerEmail: owner?.email ?? "",
          endDate: r.endDate,
          daysOverdue,
        };
      }),
    );
  },
});

/** Reserve one automatic SMTP attempt for an event, including after a retry. */
export const claimEmailDelivery = internalMutation({
  args: {
    eventId: v.string(),
    kind: v.union(v.literal("borrow_request_created"), v.literal("overdue_reminder")),
    borrowRequestId: v.id("borrowRequests"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("notificationLog")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (existing) return { claimed: false };

    await ctx.db.insert("notificationLog", {
      ...args,
      deliveryState: "claimed",
      detail: "SMTP attempt reserved",
      createdAt: Date.now(),
    });
    return { claimed: true };
  },
});

/** Complete the delivery claim, or record an error or legacy write-back. */
export const logNotification = internalMutation({
  args: {
    eventId: v.string(),
    kind: v.string(),
    borrowRequestId: v.optional(v.id("borrowRequests")),
    detail: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("notificationLog")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (existing) {
      if (existing.deliveryState === "claimed" && existing.kind === args.kind) {
        await ctx.db.patch(existing._id, {
          deliveryState: "sent",
          sentAt: Date.now(),
          detail: args.detail.slice(0, 500),
        });
        return { deduped: false, logId: existing._id };
      }
      return { deduped: true, logId: existing._id };
    }
    const logId = await ctx.db.insert("notificationLog", {
      eventId: args.eventId,
      kind: args.kind,
      borrowRequestId: args.borrowRequestId,
      detail: args.detail.slice(0, 500),
      createdAt: Date.now(),
    });
    return { deduped: false, logId };
  },
});
