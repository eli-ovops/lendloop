"use client";

import { FormEvent, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";

const inputCls =
  "w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20";

export default function ListToolForm() {
  const createTool = useMutation(api.tools.create);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Power tools");
  const [condition, setCondition] = useState("Good");
  const [location, setLocation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    setBusy(true);
    try {
      await createTool({
        name,
        description,
        category,
        condition,
        location: location || undefined,
      });
      setName("");
      setDescription("");
      setLocation("");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-xl border border-black/10 p-4 dark:border-white/15"
    >
      <h2 className="font-semibold">List a tool you can lend</h2>
      <input
        className={inputCls}
        placeholder="Tool name (e.g. Cordless drill)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <textarea
        className={inputCls}
        placeholder="Description — what it does, what's included"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        required
      />
      <div className="grid grid-cols-2 gap-3">
        <input
          className={inputCls}
          placeholder="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          required
        />
        <input
          className={inputCls}
          placeholder="Condition"
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          required
        />
      </div>
      <input
        className={inputCls}
        placeholder="Neighbourhood (optional — never your full address)"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {done && <p className="text-sm text-green-600">Tool listed!</p>}
      <button
        type="submit"
        disabled={busy}
        className="rounded-full bg-foreground px-5 py-2 text-sm text-background disabled:opacity-50"
      >
        {busy ? "Listing…" : "List tool"}
      </button>
    </form>
  );
}
