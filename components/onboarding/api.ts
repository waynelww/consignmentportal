/**
 * Calls an onboarding API route and returns its JSON. Throws the route's
 * error message on failure, so callers can show it with a toast.
 */
export async function callOnboardingApi<T = Record<string, unknown>>(
  url: string,
  method: 'GET' | 'POST' | 'PATCH' = 'GET',
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data as T
}
