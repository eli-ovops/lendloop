import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getCurrentUser, requireAdmin } from "./lib/auth";
import { publicDisplayName } from "./lib/displayName";

/**
 * Upsert the signed-in Clerk user into the `users` table.
 * Called by the client right after sign-in (see components/StoreUser.tsx).
 *
 * Role assignment:
 * - Existing users keep their stored role.
 * - New users become "admin" if their email appears in the Convex
 *   deployment env var ADMIN_EMAILS (comma-separated), otherwise "user".
 * - Further role changes happen via the internal `setRole` mutation
 *   (Convex dashboard / CLI only — internal functions are not reachable
 *   from any client), never via a public mutation.
 */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Called storeUser without authentication.");

    const name = publicDisplayName(identity.name);
    const email = identity.email ?? "";
    const existing = await getCurrentUser(ctx);
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name,
        email,
        lastSeenAt: now,
      });
      return existing._id;
    }

    const adminEmails = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const role = adminEmails.includes(email.toLowerCase())
      ? ("admin" as const)
      : ("user" as const);

    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      subject: identity.subject,
      name,
      email,
      role,
      createdAt: now,
      lastSeenAt: now,
    });
  },
});

/** Current user's record (null when signed out or not yet stored). */
export const me = query({
  args: {},
  handler: async (ctx) => {
    return await getCurrentUser(ctx);
  },
});

/** Admin-only directory listing. Enforced here, not in the admin page UI. */
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query("users").order("asc").collect();
  },
});

/**
 * Bootstrap / support role changes. Internal on purpose: it can only be
 * invoked from the Convex dashboard or `npx convex run users:setRole`,
 * so no signed-in user can escalate their own role through the API.
 */
export const setRole = internalMutation({
  args: {
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("user")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { role: args.role });
  },
});
