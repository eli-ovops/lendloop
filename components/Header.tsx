"use client";

import Link from "next/link";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

export default function Header() {
  const me = useQuery(api.users.me);

  return (
    <header className="border-b border-black/10 dark:border-white/15">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          🔁 LendLoop
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/" className="hover:underline">
            Tool board
          </Link>
          <Show when="signed-in">
            <Link href="/my" className="hover:underline">
              My loans
            </Link>
            {/* Cosmetic only — /admin data is enforced admin-only in Convex. */}
            {me?.role === "admin" && (
              <Link href="/admin" className="hover:underline">
                Admin
              </Link>
            )}
            <UserButton />
          </Show>
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button className="rounded-full bg-foreground px-4 py-1.5 text-background">
                Sign in
              </button>
            </SignInButton>
          </Show>
        </nav>
      </div>
    </header>
  );
}
