import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Lightweight authentication middleware for Edge runtime
 *
 * Purpose: Protect routes that require authentication without importing heavy
 * dependencies like Prisma (which cannot run in Edge runtime).
 *
 * Architecture:
 * - Public routes: Always accessible
 * - Protected routes: Require valid session cookie
 * - API routes: Handle their own authentication
 *
 * Note: This uses cookie-based session checking rather than full Auth.js
 * integration to keep the bundle size under the 1MB Edge Function limit.
 */

/** Routes that can be accessed without authentication */
const PUBLIC_ROUTES = ['/', '/login', '/signup'] as const

/** Routes that require authentication */
const PROTECTED_ROUTES = ['/dashboard', '/price-checker', '/deal'] as const

/**
 * Better Auth session cookie names
 * In production (HTTPS), cookies use the __Secure- prefix
 * In development (HTTP), cookies use standard names
 */
const SESSION_COOKIE_NAMES = [
  'better-auth.session_token',           // Development
  '__Secure-better-auth.session_token',  // Production HTTPS
] as const

/**
 * Check if the request has a valid session cookie
 */
function hasValidSession(request: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((cookieName) =>
    request.cookies.has(cookieName)
  )
}

/**
 * Check if the path is public (no auth required)
 */
function isPublicRoute(path: string): boolean {
  return (
    // API routes handle their own auth
    (PUBLIC_ROUTES.some((route) => path === route) || path.startsWith('/api/'))
  );
}

/**
 * Check if the path requires authentication
 */
function isProtectedRoute(path: string): boolean {
  return PROTECTED_ROUTES.some((route) => path.startsWith(route))
}

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname

  // Allow public routes
  if (isPublicRoute(path)) {
    return NextResponse.next()
  }

  // Check authentication for protected routes
  if (isProtectedRoute(path)) {
    if (!hasValidSession(request)) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('callbackUrl', path)
      return NextResponse.redirect(loginUrl)
    }
  }

  // Allow everything else (catch-all for new routes)
  return NextResponse.next()
}

export const config = {
  // Apply middleware to all routes except static files
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
