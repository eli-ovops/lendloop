import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc } from "../_generated/dataModel";

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;

/**
 * Access control lives HERE, in the Convex function layer — never only in
 * the UI. Every mutation/query that touches per-user data resolves the
 * caller through these helpers and throws before reading or writing
 * anything the caller is not entitled to.
 */

export async function getCurrentUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
}

export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) {
    throw new Error(
      "Unauthorized: you must be signed in and finish account setup first.",
    );
  }
  return user;
}

export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") {
    throw new Error("Forbidden: admin role required.");
  }
  return user;
}

/** True when the caller owns the resource or is an admin. */
export function canManage(user: Doc<"users">, ownerId: string): boolean {
  return user.role === "admin" || user._id === ownerId;
}
