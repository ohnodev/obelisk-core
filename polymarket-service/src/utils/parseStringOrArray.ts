/**
 * Parse outcomePrices / clobTokenIds from Gamma API.
 * Accepts string (JSON), array, or unknown; returns string[].
 */
export function parseStringOrArray(raw: unknown): string[] {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) {
    return raw as string[];
  }
  return [];
}
