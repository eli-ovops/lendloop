import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { verifyHmac } from "./lib/hmac";

/**
 * Signed HTTP endpoints consumed by the n8n workflows.
 *
 * Every endpoint requires the header
 *   X-LendLoop-Signature: sha256=<HMAC-SHA256 hex of the raw body>
 * keyed with the shared secret (Convex env N8N_WEBHOOK_SECRET). Unsigned
 * or badly signed calls get a 401 and touch nothing.
 *
 * Endpoints:
 * - POST /n8n/claim-email           reserve an SMTP attempt before sending
 * - POST /n8n/notification-logged  workflow 1 write-back (idempotent)
 * - POST /n8n/overdue-check        workflow 2 fetch of overdue loans
 * - POST /n8n/reminder-logged      workflow 2 write-back (idempotent)
 * - POST /n8n/error-logged         error-workflow sink (idempotent)
 *
 * Note: these live on the Convex *site* URL (https://<deployment>.convex.site),
 * not the client API URL.
 */

const http = httpRouter();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function requireValidSignature(
  request: Request,
): Promise<{ ok: true; rawBody: string } | { ok: false; res: Response }> {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret) {
    return {
      ok: false,
      res: json({ error: "N8N_WEBHOOK_SECRET is not configured" }, 500),
    };
  }
  const rawBody = await request.text();
  const valid = await verifyHmac(
    secret,
    rawBody,
    request.headers.get("x-lendloop-signature"),
  );
  if (!valid) {
    return { ok: false, res: json({ error: "Invalid signature" }, 401) };
  }
  return { ok: true, rawBody };
}

/** Reserve the signed event before n8n reaches either SMTP send node. */
http.route({
  path: "/n8n/claim-email",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await requireValidSignature(request);
    if (!auth.ok) return auth.res;
    let body: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(auth.rawBody);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return json({ error: "Expected a JSON object" }, 400);
      }
      body = value as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const { eventId, kind, borrowRequestId } = body;
    if (typeof eventId !== "string" || typeof borrowRequestId !== "string"
        || (kind !== "borrow_request_created" && kind !== "overdue_reminder")) {
      return json({ error: "Invalid email event" }, 400);
    }
    const overduePrefix = `overdue:${borrowRequestId}:`;
    const validId = kind === "borrow_request_created"
      ? eventId === `borrow-request:${borrowRequestId}`
      : eventId.startsWith(overduePrefix) &&
        /^\d{4}-\d{2}-\d{2}$/.test(eventId.slice(overduePrefix.length));
    if (!validId) return json({ error: "Invalid event ID" }, 400);

    const result = await ctx.runMutation(internal.borrowRequests.claimEmailDelivery, {
      eventId,
      kind,
      borrowRequestId: borrowRequestId as Id<"borrowRequests">,
    });
    return json(result);
  }),
});

/** Workflow 1 write-back: record that a borrow-request notification was sent. */
http.route({
  path: "/n8n/notification-logged",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await requireValidSignature(request);
    if (!auth.ok) return auth.res;
    const body = JSON.parse(auth.rawBody) as {
      eventId: string;
      borrowRequestId?: string;
      channel?: string;
    };
    if (!body.eventId) return json({ error: "eventId is required" }, 400);
    const result = await ctx.runMutation(
      internal.borrowRequests.logNotification,
      {
        eventId: body.eventId,
        kind: "borrow_request_created",
        borrowRequestId: body.borrowRequestId as Id<"borrowRequests"> | undefined,
        detail: `Notification sent via ${body.channel ?? "email"}`,
      },
    );
    return json({ ok: true, ...result });
  }),
});

/** Workflow 2 step 1: return the list of overdue loans as JSON. */
http.route({
  path: "/n8n/overdue-check",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await requireValidSignature(request);
    if (!auth.ok) return auth.res;
    const overdue = await ctx.runQuery(internal.borrowRequests.getOverdue, {});
    return json({ count: overdue.length, overdue });
  }),
});

/** Workflow 2 write-back: record one sent overdue reminder (idempotent per day). */
http.route({
  path: "/n8n/reminder-logged",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await requireValidSignature(request);
    if (!auth.ok) return auth.res;
    const body = JSON.parse(auth.rawBody) as {
      eventId: string;
      borrowRequestId?: string;
      daysOverdue?: number;
    };
    if (!body.eventId) return json({ error: "eventId is required" }, 400);
    const result = await ctx.runMutation(
      internal.borrowRequests.logNotification,
      {
        eventId: body.eventId,
        kind: "overdue_reminder",
        borrowRequestId: body.borrowRequestId as Id<"borrowRequests"> | undefined,
        detail: `Overdue reminder sent (${body.daysOverdue ?? "?"} days overdue)`,
      },
    );
    return json({ ok: true, ...result });
  }),
});

/** Error workflow sink: record an automation failure for later inspection. */
http.route({
  path: "/n8n/error-logged",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await requireValidSignature(request);
    if (!auth.ok) return auth.res;
    const body = JSON.parse(auth.rawBody) as {
      eventId: string;
      detail?: string;
    };
    if (!body.eventId) return json({ error: "eventId is required" }, 400);
    const result = await ctx.runMutation(
      internal.borrowRequests.logNotification,
      {
        eventId: body.eventId,
        kind: "error",
        detail: (body.detail ?? "n8n workflow error").slice(0, 500),
      },
    );
    return json({ ok: true, ...result });
  }),
});

export default http;
