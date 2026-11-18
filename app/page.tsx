"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { Show } from "@clerk/nextjs";
import { api } from "../convex/_generated/api";
import ListToolForm from "../components/ListToolForm";
import RequestToolForm from "../components/RequestToolForm";

/**
 * The public tool board. The underlying query (tools.list) is public and
 * read-only — signed-out visitors can browse everything. Actions that
 * change state (listing, requesting) render only for signed-in users AND
 * are independently enforced in the Convex function layer.
 */
export default function Home() {
  const [search, setSearch] = useState("");
  const [openRequestFor, setOpenRequestFor] = useState<string | null>(null);
  const tools = useQuery(api.tools.list, { search });
  const me = useQuery(api.users.me);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">
          Borrow a tool from a neighbour
        </h1>
        <p className="text-sm opacity-70">
          LendLoop is a neighbourhood lending board: drills, ladders, projectors
          and more — listed by neighbours, borrowed for a date range, returned
          on time.
        </p>
        <input
          className="w-full max-w-md rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
          placeholder="Search tools…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </section>

      <Show when="signed-in">
        <ListToolForm />
      </Show>
      <Show when="signed-out">
        <p className="rounded-xl border border-dashed border-black/15 p-4 text-sm opacity-70 dark:border-white/20">
          Sign in to list a tool or request a borrow. Browsing is open to
          everyone.
        </p>
      </Show>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tools === undefined && (
          <p className="text-sm opacity-60">Loading tools…</p>
        )}
        {tools?.length === 0 && (
          <p className="text-sm opacity-60">
            No tools listed yet — be the first to lend something!
          </p>
        )}
        {tools?.map((tool) => {
          const isMine = me?._id === tool.ownerId;
          return (
            <article
              key={tool._id}
              className="flex flex-col rounded-xl border border-black/10 p-4 dark:border-white/15"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">{tool.name}</h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    tool.available
                      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                      : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  {tool.available ? "Available" : "Unavailable"}
                </span>
              </div>
              <p className="mt-1 line-clamp-3 text-sm opacity-80">
                {tool.description}
              </p>
              <dl className="mt-3 space-y-0.5 text-xs opacity-70">
                <div>Category: {tool.category}</div>
                <div>Condition: {tool.condition}</div>
                {tool.location && <div>Area: {tool.location}</div>}
                <div>Lent by {tool.ownerName}</div>
              </dl>
              <div className="mt-auto pt-4">
                <Show when="signed-in">
                  {isMine ? (
                    <p className="text-xs opacity-60">This is your tool.</p>
                  ) : tool.available ? (
                    openRequestFor === tool._id ? (
                      <RequestToolForm toolId={tool._id} />
                    ) : (
                      <button
                        className="rounded-full border border-black/20 px-4 py-1.5 text-sm dark:border-white/25"
                        onClick={() => setOpenRequestFor(tool._id)}
                      >
                        Request to borrow
                      </button>
                    )
                  ) : (
                    <p className="text-xs opacity-60">
                      Currently out on loan.
                    </p>
                  )}
                </Show>
                <Show when="signed-out">
                  <p className="text-xs opacity-60">Sign in to request.</p>
                </Show>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
