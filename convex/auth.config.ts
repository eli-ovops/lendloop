/**
 * Convex <-> Clerk JWT verification.
 *
 * In the Clerk dashboard, create a JWT template named "convex" and copy its
 * Issuer URL into the Convex deployment env var CLERK_JWT_ISSUER_DOMAIN
 * (Convex dashboard -> Settings -> Environment Variables, or
 * `npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-clerk-domain>`).
 */
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
