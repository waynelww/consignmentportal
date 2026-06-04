/**
 * Cache headers for admin aggregation endpoints.
 *
 * Strategy:
 *   - `private` so Vercel/CDN never serves one admin's response to another
 *   - `s-maxage=N`: edge-cache for N seconds (admin's own subsequent calls)
 *   - `stale-while-revalidate=M`: keep serving the stale value for M seconds
 *     while the next request triggers a background refresh
 *
 * Net effect: flipping between filter combinations in the admin UI gets
 * instant responses for the first N seconds, then "stale but fast" for the
 * next M seconds while a fresh copy is being prepared. No data is older
 * than N+M seconds.
 */
export function adminCacheHeaders(maxAgeSeconds = 60, swr = 300) {
  return {
    'Cache-Control': `private, max-age=${maxAgeSeconds}, s-maxage=${maxAgeSeconds}, stale-while-revalidate=${swr}`,
  }
}

/**
 * Wrap a Response.json() return so it carries admin cache headers.
 * Use only on read-only routes that admin users hit repeatedly.
 */
export function cachedAdminJson(body: unknown, init?: { status?: number; maxAgeSeconds?: number; swr?: number }) {
  return Response.json(body, {
    status: init?.status ?? 200,
    headers: adminCacheHeaders(init?.maxAgeSeconds, init?.swr),
  })
}
