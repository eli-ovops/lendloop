import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { canManage, requireUser } from "./lib/auth";
import { publicDisplayName } from "./lib/displayName";
import { findApprovedLoan } from "./lib/loans";

/**
 * Public, read-only board. Deliberately callable WITHOUT authentication:
 * anyone can browse what the neighbourhood offers. It exposes only the
 * fields a browser needs (no owner email — contact happens through the
 * borrow-request flow, which keeps addresses off the public surface).
 */
export const list = query({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("tools").order("desc").collect();
    const search = args.search?.trim().toLowerCase();
    const filtered = search
      ? all.filter(
          (t) =>
            t.name.toLowerCase().includes(search) ||
            t.description.toLowerCase().includes(search) ||
            t.category.toLowerCase().includes(search),
        )
      : all;

    return await Promise.all(
      filtered.map(async (tool) => {
        const [owner, activeLoan] = await Promise.all([
          ctx.db.get(tool.ownerId),
          tool.available ? findApprovedLoan(ctx.db, tool._id) : null,
        ]);
        return {
          _id: tool._id,
          ownerId: tool.ownerId,
          name: tool.name,
          description: tool.description,
          category: tool.category,
          condition: tool.condition,
          location: tool.location,
          available: tool.available && !activeLoan,
          ownerName: publicDisplayName(owner?.name),
        };
      }),
    );
  },
});

/** Tools owned by the signed-in caller. */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .collect();
  },
});

/** List a new tool. Any signed-in user may lend. */
export const create = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    category: v.string(),
    condition: v.string(),
    location: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const name = args.name.trim();
    if (name.length < 2) throw new Error("Tool name is too short.");
    return await ctx.db.insert("tools", {
      ownerId: user._id,
      name,
      description: args.description.trim(),
      category: args.category.trim(),
      condition: args.condition.trim(),
      location: args.location?.trim() || undefined,
      available: true,
      createdAt: Date.now(),
    });
  },
});

/** Toggle availability. Owner or admin only — enforced server-side. */
export const setAvailability = mutation({
  args: { toolId: v.id("tools"), available: v.boolean() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) throw new Error("Tool not found.");
    if (!canManage(user, tool.ownerId)) {
      throw new Error("Forbidden: only the owner or an admin can do that.");
    }
    if (args.available && (await findApprovedLoan(ctx.db, tool._id))) {
      throw new Error(
        "Mark the active loan returned before making this tool available.",
      );
    }
    await ctx.db.patch(args.toolId, { available: args.available });
  },
});

/**
 * Remove a tool. Owner or admin only. Pending requests against the tool
 * are cancelled so borrowers are not left hanging.
 */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) throw new Error("Tool not found.");
    if (!canManage(user, tool.ownerId)) {
      throw new Error("Forbidden: only the owner or an admin can do that.");
    }
    if (await findApprovedLoan(ctx.db, tool._id)) {
      throw new Error("Mark the active loan returned before removing this tool.");
    }
    const pending = await ctx.db
      .query("borrowRequests")
      .withIndex("by_tool", (q) => q.eq("toolId", args.toolId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();
    for (const req of pending) {
      await ctx.db.patch(req._id, { status: "cancelled" });
    }
    await ctx.db.delete(args.toolId);
  },
});
