import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionToken } from "@/lib/auth";

// Runs in the Node runtime so it can read the password from env and set a
// long-lived httpOnly cookie. The password never goes back to the browser.
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const submitted = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/board");
  const expected = process.env.CHALK_PASSWORD;

  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/board";

  if (!expected || submitted !== expected) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "1");
    if (safeNext !== "/board") url.searchParams.set("next", safeNext);
    return NextResponse.redirect(url, { status: 303 });
  }

  const response = NextResponse.redirect(new URL(safeNext, request.url), { status: 303 });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: await sessionToken(expected),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
  return response;
}
