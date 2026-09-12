import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionToken } from "@/lib/auth";

// Renamed from middleware.ts: Next 16 deprecated that convention in favour of
// proxy.ts, which always runs in the Node runtime. Lives beside src/app so the
// framework picks it up.
export async function proxy(request: NextRequest) {
  const password = process.env.CHALK_PASSWORD;
  if (!password) {
    return new NextResponse("CHALK_PASSWORD is not set on this deployment.", {
      status: 500,
      headers: { "content-type": "text/plain" },
    });
  }

  const presented = request.cookies.get(SESSION_COOKIE)?.value;
  if (presented && presented === (await sessionToken(password))) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const wanted = request.nextUrl.pathname;
  if (wanted && wanted !== "/") url.searchParams.set("next", wanted);
  return NextResponse.redirect(url);
}

// Everything is gated except the login flow and the assets a browser needs
// before it can log in, including the PWA shell.
export const config = {
  matcher: [
    "/((?!login|api/login|manifest.webmanifest|sw\\.js|offline|icons/|favicon.ico|_next/static|_next/image).*)",
  ],
};
