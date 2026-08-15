/**
 * Escape every RegExp metacharacter so user input can never alter the pattern's
 * meaning. Without this, a search for `a.*` becomes a wildcard scan, and a
 * pathological pattern becomes a ReDoS vector.
 */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
