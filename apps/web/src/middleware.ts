import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);
const devAuth = process.env.NODE_ENV !== "production" && !!process.env.DEV_AUTH_USER;

export default devAuth
  ? () => NextResponse.next()
  : clerkMiddleware(async (auth, req) => {
      if (!isPublic(req)) await auth.protect();
    });

export const config = {
  matcher: ["/((?!_next|.*\\.(?:css|js|png|jpg|svg|ico|woff2?)$).*)"],
};
