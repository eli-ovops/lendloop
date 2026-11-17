"use client";

import { useEffect, useRef } from "react";
import { useUser } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";

/**
 * After Clerk sign-in, upsert the user into Convex (`users.store`) so the
 * function layer can resolve roles and ownership. Runs once per session
 * identity; the mutation itself is idempotent.
 */
export default function StoreUser() {
  const { isLoaded, isSignedIn, user } = useUser();
  const storeUser = useMutation(api.users.store);
  const storedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;
    if (storedFor.current === user.id) return;
    storedFor.current = user.id;
    void storeUser().catch(() => {
      // Allow a retry on the next render if the first attempt raced
      // token propagation.
      storedFor.current = null;
    });
  }, [isLoaded, isSignedIn, user, storeUser]);

  return null;
}
