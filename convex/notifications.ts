import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { hmacSha256Hex } from "./lib/hmac";

/**
 * Outbound notification: Convex -> n8n (workflow 1: borrow-request
 * notification).
 *
 * Triggered by ctx.scheduler from the borrowRequests.request mutation, so
 * it only ever fires for a request that was actually committed.
 *
 * The JSON body is signed with HMAC-SHA256 and sent as
 * `X-LendLoop-Signature: sha256=<hex>`. n8n verifies the signature before
 * doing anything (see n8n/01-borrow-request-notification.json), and the
 * payload carries a stable `eventId` so the workflow's write-back to
 * Convex is idempotent.
 *
 * Required Convex deployment env vars:
 * - N8N_BORROW_WEBHOOK_URL  (the n8n webhook production URL)
 * - N8N_WEBHOOK_SECRET       (shared HMAC secret, same value as n8n's
 *                             LENDLOOP_WEBHOOK_SECRET)
 * If either is unset (e.g. local dev without n8n), the action logs and
 * returns instead of failing the borrow flow.
 */
export const sendBorrowRequestNotification = internalAction({
  args: { borrowRequestId: v.id("borrowRequests") },
  handler: async (ctx, args) => {
    const webhookUrl = process.env.N8N_BORROW_WEBHOOK_URL;
    const secret = process.env.N8N_WEBHOOK_SECRET;
    if (!webhookUrl || !secret) {
      console.log(
        "[lendloop] N8N_BORROW_WEBHOOK_URL / N8N_WEBHOOK_SECRET not set; " +
          "skipping borrow-request notification.",
      );
      return { skipped: true };
    }

    const detail = await ctx.runQuery(internal.borrowRequests.getDetail, {
      borrowRequestId: args.borrowRequestId,
    });
    if (!detail) return { skipped: true };

    const payload = {
      event: "borrow_request.created",
      eventId: `borrow-request:${detail.borrowRequestId}`,
      sentAt: new Date().toISOString(),
      borrowRequestId: detail.borrowRequestId,
      tool: detail.tool,
      borrower: detail.borrower,
      owner: detail.owner,
      startDate: detail.startDate,
      endDate: detail.endDate,
      note: detail.note,
    };
    const rawBody = JSON.stringify(payload);
    const signature = await hmacSha256Hex(secret, rawBody);

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-LendLoop-Signature": `sha256=${signature}`,
        "X-LendLoop-Event-Id": payload.eventId,
      },
      body: rawBody,
    });
    if (!res.ok) {
      // Surfaced in Convex logs; the n8n error workflow covers failures
      // on the n8n side, and the write-back log shows whether a given
      // eventId ever landed.
      throw new Error(
        `n8n borrow-request webhook returned ${res.status} ${res.statusText}`,
      );
    }
    return { sent: true, eventId: payload.eventId };
  },
});
