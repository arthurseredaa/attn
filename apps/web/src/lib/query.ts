/** `?a=1&b=x&b=y`; an array repeats its key. Undefined, empty strings and empty arrays are left out. */
export function buildQueryString(params: Record<string, string | number | string[] | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    for (const item of Array.isArray(v) ? v : [v]) {
      if (item === '') continue;
      sp.append(k, String(item));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}
