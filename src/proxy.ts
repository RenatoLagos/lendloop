import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Coarse gate only: keeps anonymous visitors off app pages. The real
// authorisation (identity, ownership, admin role) is enforced in Convex functions.
const isProtected = createRouteMatcher(["/tools(.*)", "/my(.*)", "/admin(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
