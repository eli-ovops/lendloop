"use client";

import { useQuery } from "convex/react";
import { Show } from "@clerk/nextjs";
import { api } from "../../convex/_generated/api";

/**
 * Admin oversight. The page hides the data for non-admins, but that is
 * only cosmetic: `borrowRequests.listAll` and `users.listAll` both call
 * requireAdmin() inside Convex and throw for non-admin callers, so the
 * data cannot be pulled from the API directly either.
 */
export default function AdminPage() {
  const me = useQuery(api.users.me);
  const isAdmin = me?.role === "admin";
  const requests = useQuery(
    api.borrowRequests.listAll,
    isAdmin ? {} : "skip",
  );
  const users = useQuery(api.users.listAll, isAdmin ? {} : "skip");

  return (
    <>
      <Show when="signed-out">
        <p className="text-sm opacity-70">Sign in as an admin to continue.</p>
      </Show>
      <Show when="signed-in">
        {me === undefined && <p className="text-sm opacity-60">Loading…</p>}
        {me !== undefined && !isAdmin && (
          <p className="text-sm opacity-70">
            This area is for admins only. Your role is “{me?.role ?? "unknown"}”.
          </p>
        )}
        {isAdmin && (
          <div className="space-y-10">
            <section>
              <h1 className="mb-3 text-xl font-bold">All borrow requests</h1>
              {requests === undefined && (
                <p className="text-sm opacity-60">Loading…</p>
              )}
              <ul className="space-y-2">
                {requests?.map((r) => (
                  <li
                    key={r._id}
                    className="rounded-lg border border-black/10 px-4 py-2 text-sm dark:border-white/15"
                  >
                    <span className="font-medium">{r.toolName}</span> —{" "}
                    {r.borrowerName} ← {r.ownerName} · {r.startDate} →{" "}
                    {r.endDate} · <span className="opacity-70">{r.status}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h2 className="mb-3 text-xl font-bold">Users</h2>
              <ul className="space-y-2">
                {users?.map((u) => (
                  <li
                    key={u._id}
                    className="rounded-lg border border-black/10 px-4 py-2 text-sm dark:border-white/15"
                  >
                    {u.name} · {u.email} ·{" "}
                    <span className="opacity-70">{u.role}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </Show>
    </>
  );
}
