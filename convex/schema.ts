import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * LendLoop data model.
 *
 * Data minimisation notes:
 * - We store only what the lending flow needs: a display name + email for
 *   coordination, tool metadata, and borrow-request state. No postal
 *   addresses, no phone numbers, no message free-text beyond an optional
 *   short borrow note.
 * - `borrowRequests.ownerId` is denormalised from the tool owner so the
 *   owner inbox query does not need a join, and so access checks in
 *   mutations are a single document read.
 */
export default defineSchema({
  users: defineTable({
    // Clerk identity. `tokenIdentifier` is the stable Convex auth key
    // (issuer + subject) returned by ctx.auth.getUserIdentity().
    tokenIdentifier: v.string(),
    subject: v.string(),
    name: v.string(),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("user")),
    createdAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_email", ["email"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    description: v.string(),
    category: v.string(),
    condition: v.string(), // e.g. "good", "light wear"
    location: v.optional(v.string()), // neighbourhood-level only, never a full address
    available: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_available", ["available"]),

  borrowRequests: defineTable({
    toolId: v.id("tools"),
    borrowerId: v.id("users"),
    ownerId: v.id("users"), // denormalised tool owner at request time
    startDate: v.string(), // YYYY-MM-DD, first day of the borrow
    endDate: v.string(), // YYYY-MM-DD, return-by date
    note: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("declined"),
      v.literal("cancelled"),
      v.literal("returned"),
    ),
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
  })
    .index("by_tool", ["toolId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_owner", ["ownerId"])
    .index("by_status", ["status"]),

  /**
   * Append-only log of automation events written back by n8n.
   * `eventId` is the idempotency key: the write-back mutation refuses to
   * insert a second row for the same eventId, so retried webhooks and
   * repeated daily reminder runs cannot duplicate effects.
   */
  notificationLog: defineTable({
    eventId: v.string(),
    kind: v.string(), // "borrow_request_created" | "overdue_reminder" | "error"
    borrowRequestId: v.optional(v.id("borrowRequests")),
    detail: v.string(),
    createdAt: v.number(),
  }).index("by_eventId", ["eventId"]),
});
