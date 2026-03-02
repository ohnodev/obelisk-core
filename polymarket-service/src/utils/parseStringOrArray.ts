function filterToStrings(arr: unknown[]): string[] {
  return arr.filter((x): x is string => typeof x === 'string');
}

/**
 * Parse outcomePrices / clobTokenIds from Gamma API.
 * Accepts string (JSON), array, or unknown; returns string[] with only string elements.
 */
export function parseStringOrArray(raw: unknown): string[] {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? filterToStrings(parsed) : [];
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) {
    return filterToStrings(raw);
  }
  return [];
}
