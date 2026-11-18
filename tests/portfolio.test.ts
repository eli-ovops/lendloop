import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { convexTest } from "convex-test";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { hmacSha256Hex } from "../convex/lib/hmac";
import schema from "../convex/schema";

const modules = {
  "../convex/_generated/api.ts": () => import("../convex/_generated/api"),
  "../convex/borrowRequests.ts": () => import("../convex/borrowRequests"),
  "../convex/http.ts": () => import("../convex/http"),
  "../convex/tools.ts": () => import("../convex/tools"),
  "../convex/users.ts": () => import("../convex/users"),
};

async function fixture(name?: string) {
  const t = convexTest({ schema, modules });
  const owner = t.withIdentity({
    subject: "fixture-owner",
    email: "owner@example.test",
    name,
  });
  const borrower = t.withIdentity({ subject: "fixture-borrower", name: "Borrower" });
  const anotherBorrower = t.withIdentity({
    subject: "fixture-second-borrower",
    name: "Second borrower",
  });
  const ownerId = await owner.mutation(api.users.store, {});
  const borrowerId = await borrower.mutation(api.users.store, {});
  const anotherBorrowerId = await anotherBorrower.mutation(api.users.store, {});
  const toolId = await owner.mutation(api.tools.create, {
    name: "Demo drill",
    category: "Tools",
    condition: "Good",
    description: "A corded drill",
  });

  // Seed past requests directly, so these tests never schedule a notification.
  function addRequest(
    status: "pending" | "approved" = "pending",
    requester: Id<"users"> = borrowerId,
  ) {
    return t.run((ctx) => ctx.db.insert("borrowRequests", {
      borrowerId: requester,
      ownerId,
      toolId,
      startDate: "2025-01-05",
      endDate: "2025-01-06",
      createdAt: 1,
      status,
    }));
  }
  return { t, owner, ownerId, borrower, anotherBorrowerId, toolId, addRequest };
}

test("a tool stays unavailable for its single active loan until the owner marks it returned", async () => {
  const { t, owner, borrower, anotherBorrowerId, toolId, addRequest } = await fixture();
  const requestId = await addRequest();
  const secondId = await addRequest("pending", anotherBorrowerId);
  await assert.rejects(borrower.mutation(api.borrowRequests.approve, { requestId }), /Forbidden/);
  await owner.mutation(api.borrowRequests.approve, { requestId });
  await assert.rejects(owner.mutation(api.borrowRequests.approve, { requestId: secondId }), /unavailable/);
  await assert.rejects(owner.mutation(api.tools.setAvailability, { toolId, available: true }), /active loan/);
  await assert.rejects(owner.mutation(api.tools.remove, { toolId }), /active loan/);
  assert.equal((await t.query(api.tools.list, {}))[0].available, false);
  await owner.mutation(api.borrowRequests.markReturned, { requestId });
  assert.equal((await t.query(api.tools.list, {}))[0].available, true);
  await owner.mutation(api.borrowRequests.approve, { requestId: secondId });
});

test("retiring a legacy duplicate keeps the board unavailable until the last loan returns", async () => {
  const { t, owner, borrower, toolId, anotherBorrowerId, addRequest } = await fixture();
  const requestId = await addRequest("approved");
  const secondId = await addRequest("approved", anotherBorrowerId);
  assert.equal((await t.query(api.tools.list, {}))[0].available, false);
  await assert.rejects(borrower.mutation(api.borrowRequests.request, {
    toolId, startDate: "2025-01-05", endDate: "2025-01-06",
  }), /unavailable/);
  await owner.mutation(api.borrowRequests.markReturned, { requestId });
  assert.equal((await t.query(api.tools.list, {}))[0].available, false);
  await owner.mutation(api.borrowRequests.markReturned, { requestId: secondId });
  assert.equal((await t.query(api.tools.list, {}))[0].available, true);
});

test("an existing loan can be closed if an older version already removed its tool", async () => {
  const { t, owner, toolId, addRequest } = await fixture();
  const requestId = await addRequest("approved");
  await t.run((ctx) => ctx.db.delete(toolId));
  await owner.mutation(api.borrowRequests.markReturned, { requestId });
  const request = await t.run((ctx) => ctx.db.get(requestId));
  assert.equal(request?.status, "returned");
});

test("public owner labels use a safe name even for legacy email-only records", async () => {
  const { t, owner, ownerId } = await fixture();
  assert.equal((await owner.query(api.users.me, {}))?.name, "Neighbour");
  await t.run((ctx) => ctx.db.patch(ownerId, { name: "owner@example.test" }));
  const [item] = await t.query(api.tools.list, {});
  assert.equal(item.ownerName, "Neighbour");
  assert.equal(Object.hasOwn(item, "email"), false);
  assert.equal(Object.hasOwn(item, "createdAt"), false);
  await t.run((ctx) => ctx.db.patch(ownerId, { name: " Alex " }));
  assert.equal((await t.query(api.tools.list, {}))[0].ownerName, "Alex");
});

test("signed delivery claims permit one attempt and preserve the completion receipt", async (context) => {
  const { t, addRequest } = await fixture();
  const borrowRequestId = await addRequest();
  const eventId = `borrow-request:${borrowRequestId}`;
  const body = JSON.stringify({ eventId, borrowRequestId, kind: "borrow_request_created" });
  const secret = "fixture-only-hmac";
  const previous = process.env.N8N_WEBHOOK_SECRET;
  process.env.N8N_WEBHOOK_SECRET = secret;
  context.after(() => {
    if (previous === undefined) delete process.env.N8N_WEBHOOK_SECRET;
    else process.env.N8N_WEBHOOK_SECRET = previous;
  });
  const signature = `sha256=${await hmacSha256Hex(secret, body)}`;
  const rejected = await t.fetch("/n8n/claim-email", { method: "POST", body });
  assert.equal(rejected.status, 401);
  const sendClaim = () => t.fetch("/n8n/claim-email", {
    method: "POST",
    body,
    headers: { "X-LendLoop-Signature": signature },
  });
  const first = await sendClaim();
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { claimed: true });
  assert.deepEqual(await (await sendClaim()).json(), { claimed: false });

  const receipt = JSON.stringify({ eventId, borrowRequestId, channel: "email" });
  const receiptSignature = `sha256=${await hmacSha256Hex(secret, receipt)}`;
  const record = () => t.fetch("/n8n/notification-logged", {
    method: "POST",
    body: receipt,
    headers: { "X-LendLoop-Signature": receiptSignature },
  });
  assert.equal((await (await record()).json()).deduped, false);
  assert.equal((await (await record()).json()).deduped, true);
  assert.deepEqual(await (await sendClaim()).json(), { claimed: false });
  const rows = await t.run((ctx) => ctx.db.query("notificationLog").collect());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].deliveryState, "sent");
});

test("legacy sent reminders are already claimed for their UTC day", async () => {
  const { t, addRequest } = await fixture();
  const borrowRequestId = await addRequest("approved");
  const kind = "overdue_reminder";
  const eventId = `overdue:${borrowRequestId}:2025-01-07`;
  await t.mutation(internal.borrowRequests.logNotification, {
    eventId, kind, borrowRequestId, detail: "Legacy SMTP acceptance",
  });
  assert.deepEqual(await t.mutation(internal.borrowRequests.claimEmailDelivery, {
    eventId, kind, borrowRequestId,
  }), { claimed: false });
  const nextEvent = `overdue:${borrowRequestId}:2025-01-08`;
  assert.deepEqual(await t.mutation(internal.borrowRequests.claimEmailDelivery, {
    eventId: nextEvent, kind, borrowRequestId,
  }), { claimed: true });
});

for (const [name, smtp, finish] of [
  ["01-borrow-request-notification", "Email tool owner", "Build signed write-back"],
  ["02-daily-overdue-reminders", "Email borrower reminder", "Build signed reminder write-back"],
]) {
  test(`${name} sends only after a successful claim and keeps the SMTP receipt linked`, () => {
    const workflow = JSON.parse(readFileSync(join(__dirname, "../n8n", `${name}.json`), "utf8")) as {
      connections: Record<string, { main: { node: string }[][] }>;
      nodes: { name: string; parameters: { jsCode?: string }; retryOnFail?: boolean }[];
    };
    const edges = workflow.connections;
    const node = (label: string) => workflow.nodes.find((item) => item.name === label);
    assert.equal(edges["Build signed delivery claim"].main[0][0].node, "Claim email delivery");
    assert.equal(edges["Claim email delivery"].main[0][0].node, "Delivery claimed?");
    assert.equal(edges["Delivery claimed?"].main[0][0].node, smtp);
    const incomingSmtp = Object.entries(edges).filter(([, value]) =>
      value.main.flat().some((edge) => edge.node === smtp)
    );
    assert.deepEqual(incomingSmtp.map(([label]) => label), ["Delivery claimed?"]);
    assert.equal(node(smtp)?.retryOnFail, false);
    const isReminder = name.startsWith("02");
    if (isReminder) {
      assert.deepEqual(edges["Loop over loans"].main[0], []);
      assert.equal(edges["Loop over loans"].main[1][0].node, "Build signed delivery claim");
      assert.equal(edges["Delivery claimed?"].main[1][0].node, "Loop over loans");
    }

    const sample = {
      eventId: isReminder ? "overdue:fixture:2025-01-09" : "borrow-request:fixture",
      borrowRequestId: "fixture",
      daysOverdue: 3,
    };
    const secret = "workflow-test-fixture";
    const site = "https://convex.example.test";
    const runNode = (label: string, input: object) => {
      const code = node(label)?.parameters.jsCode;
      assert.ok(code);
      const [{ json }] = runInNewContext(`(() => {\n${code}\n})()`, {
        $env: { LENDLOOP_WEBHOOK_SECRET: secret, CONVEX_SITE_URL: site },
        $input: { first: () => ({ json: input }) },
        $: (source: string) => {
          assert.equal(source, isReminder ? "Loop over loans" : "Compose owner email");
          return { itemMatching: () => ({ json: sample }) };
        },
        require: (moduleName: string) => {
          assert.equal(moduleName, "crypto");
          return { createHmac };
        },
      }, { timeout: 1000 }) as [{ json: { rawBody: string; signature: string; url: string } }];
      assert.equal(json.signature, "sha256=" + createHmac("sha256", secret)
        .update(json.rawBody, "utf8").digest("hex"));
      return json;
    };
    const claim = runNode("Build signed delivery claim", sample);
    assert.equal(claim.url, site + "/n8n/claim-email");
    assert.equal(JSON.parse(claim.rawBody).kind, isReminder ? "overdue_reminder" : "borrow_request_created");
    const receipt = runNode(finish, { response: "250 accepted (fixture)" });
    assert.equal(receipt.url, site + (isReminder ? "/n8n/reminder-logged" : "/n8n/notification-logged"));
    assert.equal(JSON.parse(receipt.rawBody).eventId, sample.eventId);
  });
}
