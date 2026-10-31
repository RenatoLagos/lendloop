import type { AuthConfig } from "convex/server";

// Clerk JWT template named "convex" (aud = "convex"). The issuer domain is the
// Clerk Frontend API URL, set as a Convex env var (see README).
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
