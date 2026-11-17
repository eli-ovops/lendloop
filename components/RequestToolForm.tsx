"use client";

import { FormEvent, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const inputCls =
  "w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20";

export default function RequestToolForm({ toolId }: { toolId: Id<"tools"> }) {
  const requestBorrow = useMutation(api.borrowRequests.request);
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestBorrow({
        toolId,
        startDate,
        endDate,
        note: note || undefined,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="text-sm text-green-600">
        Request sent! The owner gets a notification and can approve or decline
        it under “My loans”.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs opacity-70">
          From
          <input
            type="date"
            className={inputCls}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </label>
        <label className="text-xs opacity-70">
          Return by
          <input
            type="date"
            className={inputCls}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
        </label>
      </div>
      <input
        className={inputCls}
        placeholder="Short note for the owner (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={200}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="rounded-full bg-foreground px-4 py-1.5 text-sm text-background disabled:opacity-50"
      >
        {busy ? "Sending…" : "Request to borrow"}
      </button>
    </form>
  );
}
