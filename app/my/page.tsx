"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Show } from "@clerk/nextjs";
import { api } from "../../convex/_generated/api";

const statusCls: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  approved: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  declined: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  cancelled: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  returned: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${statusCls[status] ?? ""}`}
    >
      {status}
    </span>
  );
}

function ActionButton({
  label,
  onClick,
  onError,
}: {
  label: string;
  onClick: () => Promise<unknown>;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      className="rounded-full border border-black/20 px-3 py-1 text-xs disabled:opacity-50 dark:border-white/25"
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } catch (err) {
          onError(err instanceof Error ? err.message : "Action failed.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "…" : label}
    </button>
  );
}

export default function MyLoansPage() {
  const [error, setError] = useState<string | null>(null);
  const incoming = useQuery(api.borrowRequests.myIncoming);
  const outgoing = useQuery(api.borrowRequests.myOutgoing);
  const myTools = useQuery(api.tools.listMine);

  const approve = useMutation(api.borrowRequests.approve);
  const decline = useMutation(api.borrowRequests.decline);
  const cancel = useMutation(api.borrowRequests.cancel);
  const markReturned = useMutation(api.borrowRequests.markReturned);
  const setAvailability = useMutation(api.tools.setAvailability);
  const removeTool = useMutation(api.tools.remove);

  return (
    <>
      <Show when="signed-out">
        <p className="text-sm opacity-70">
          Sign in to see your tools, borrow requests and loans.
        </p>
      </Show>
      <Show when="signed-in">
        <div className="space-y-10">
          {error && <p className="text-sm text-red-600">{error}</p>}

          <section>
            <h1 className="mb-3 text-xl font-bold">Requests for my tools</h1>
            {incoming === undefined && (
              <p className="text-sm opacity-60">Loading…</p>
            )}
            {incoming?.length === 0 && (
              <p className="text-sm opacity-60">No requests yet.</p>
            )}
            <ul className="space-y-3">
              {incoming?.map((r: any) => (
                <li
                  key={r._id}
                  className="rounded-xl border border-black/10 p-4 dark:border-white/15"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{r.toolName}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="mt-1 text-sm opacity-80">
                    {r.borrowerName} · {r.startDate} → {r.endDate}
                    {r.note ? ` · “${r.note}”` : ""}
                  </p>
                  <div className="mt-2 flex gap-2">
                    {r.status === "pending" && (
                      <>
                        <ActionButton
                          label="Approve"
                          onError={setError}
                          onClick={() => approve({ requestId: r._id })}
                        />
                        <ActionButton
                          label="Decline"
                          onError={setError}
                          onClick={() => decline({ requestId: r._id })}
                        />
                      </>
                    )}
                    {r.status === "approved" && (
                      <ActionButton
                        label="Mark returned"
                        onError={setError}
                        onClick={() => markReturned({ requestId: r._id })}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-bold">Tools I am borrowing</h2>
            {outgoing === undefined && (
              <p className="text-sm opacity-60">Loading…</p>
            )}
            {outgoing?.length === 0 && (
              <p className="text-sm opacity-60">
                You have not requested anything yet — browse the board!
              </p>
            )}
            <ul className="space-y-3">
              {outgoing?.map((r: any) => (
                <li
                  key={r._id}
                  className="rounded-xl border border-black/10 p-4 dark:border-white/15"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{r.toolName}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="mt-1 text-sm opacity-80">
                    Owner {r.ownerName} · {r.startDate} → return by {r.endDate}
                  </p>
                  {r.status === "pending" && (
                    <div className="mt-2">
                      <ActionButton
                        label="Cancel request"
                        onError={setError}
                        onClick={() => cancel({ requestId: r._id })}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-bold">My tools</h2>
            {myTools === undefined && (
              <p className="text-sm opacity-60">Loading…</p>
            )}
            {myTools?.length === 0 && (
              <p className="text-sm opacity-60">
                You have not listed any tools yet.
              </p>
            )}
            <ul className="space-y-3">
              {myTools?.map((t: any) => (
                <li
                  key={t._id}
                  className="flex items-center justify-between rounded-xl border border-black/10 p-4 dark:border-white/15"
                >
                  <div>
                    <span className="font-medium">{t.name}</span>
                    <span className="ml-2 text-xs opacity-60">
                      {t.available ? "Available" : "On loan / unavailable"}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <ActionButton
                      label={t.available ? "Pause" : "Make available"}
                      onError={setError}
                      onClick={() =>
                        setAvailability({
                          toolId: t._id,
                          available: !t.available,
                        })
                      }
                    />
                    <ActionButton
                      label="Remove"
                      onError={setError}
                      onClick={() => removeTool({ toolId: t._id })}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </Show>
    </>
  );
}
