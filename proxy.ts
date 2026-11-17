import { clerkMiddleware } from "@clerk/nextjs/server";

// Next.js 16 renamed the `middleware` file convention to `proxy`.
// clerkMiddleware keeps the Clerk session fresh on navigations; all actual
// authorisation for LendLoop data happens in the Convex function layer.
export const proxy = clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and static files.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
