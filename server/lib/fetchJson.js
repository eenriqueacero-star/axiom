/**
 * Finnhub (and others) 302-redirect non-free endpoints to a marketing HTML page
 * that fetch follows to a 200 — so never trust res.ok alone. Content-type guard.
 */
export async function safeJson(res) {
  if (!res.ok) return null;
  if (!res.headers.get('content-type')?.includes('application/json')) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}
