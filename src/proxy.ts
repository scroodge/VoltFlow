import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/forgot-password",
  "/auth/callback",
  "/telegram",
  "/knowledge/search",
]);
const PUBLIC_METADATA_PATHS = new Set([
  "/apple-icon",
  "/favicon.ico",
  "/icon",
  "/manifest.webmanifest",
  "/sw.js",
]);
const DEV_AUTH_PREFIXES = [
  "/admin",
  "/cars",
  "/charging",
  "/dashboard",
  "/history",
  "/settings",
  "/vehicle",
];
const DIRECT_DEV_PATH_PREFIXES = [
  "/dev/api",
  "/dev/bydmate-diplus",
  "/dev/vehicle-control",
  "/dev/vehicle-telemetry-fixtures",
];
const DEV_SITE_PREFIX = "/dev/site";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { pathname } = request.nextUrl;
  const isDevelopment = process.env.NODE_ENV !== "production";

  const isPublic =
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/telegram/") ||
    pathname.startsWith("/legal/");
  const isDevAuthPath = DEV_AUTH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (
    isDevelopment &&
    (pathname === DEV_SITE_PREFIX || pathname.startsWith(`${DEV_SITE_PREFIX}/`))
  ) {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname =
      pathname.slice(DEV_SITE_PREFIX.length).replace(/^\/?/, "/") || "/";

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-voltflow-dev-auth-bypass", "1");
    requestHeaders.set("x-voltflow-dev-path-prefix", DEV_SITE_PREFIX);

    return NextResponse.rewrite(rewriteUrl, {
      request: {
        headers: requestHeaders,
      },
    });
  }

  if (
    isDevelopment &&
    DIRECT_DEV_PATH_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  ) {
    return response;
  }

  if (isDevelopment && pathname.startsWith("/dev/")) {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = pathname.replace(/^\/dev(?=\/)/, "") || "/";

    const isDevRewriteAuthPath = DEV_AUTH_PREFIXES.some(
      (prefix) =>
        rewriteUrl.pathname === prefix || rewriteUrl.pathname.startsWith(`${prefix}/`),
    );

    if (!isDevRewriteAuthPath) {
      return response;
    }

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-voltflow-dev-auth-bypass", "1");
    requestHeaders.set("x-voltflow-dev-path-prefix", "/dev");

    return NextResponse.rewrite(rewriteUrl, {
      request: {
        headers: requestHeaders,
      },
    });
  }

  if (
    (isDevelopment && pathname.startsWith("/api/dev/")) ||
    pathname.startsWith("/api/bydmate/") ||
    (isDevelopment &&
      pathname.startsWith("/api/vehicle/") &&
      request.nextUrl.searchParams.get("dev") === "1") ||
    PUBLIC_METADATA_PATHS.has(pathname) ||
    pathname.startsWith("/icons/") ||
    pathname.endsWith(".webmanifest")
  ) {
    return response;
  }

  if (isDevelopment && !isPublic && isDevAuthPath) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-voltflow-dev-auth-bypass", "1");

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return response;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && pathname === "/login") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.searchParams.delete("next");
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
