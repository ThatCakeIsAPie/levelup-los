/**
 * Multi-select filters in the URL: a list is kept as one comma-separated
 * search param (`?stage=apprentice,ibo`), so links stay short and readable.
 */

/**
 * Read a list param: keeps only allowed values, in the order of `allowed`,
 * without duplicates. Accepts a comma-separated string or an array (older
 * links). Returns undefined when nothing valid is left (= no filter).
 */
export function parseListParam<T extends string>(
  raw: unknown,
  allowed: readonly T[],
): T[] | undefined {
  const parts = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === "string"
      ? raw.split(",")
      : typeof raw === "number"
        ? [String(raw)]
        : [];
  const set = new Set(parts.map((s) => s.trim()));
  const out = allowed.filter((v) => set.has(v));
  return out.length ? out : undefined;
}

/** Write a list param: undefined for an empty list, so the param drops out of the URL. */
export function listParam(list: readonly string[] | undefined): string | undefined {
  return list && list.length ? list.join(",") : undefined;
}

/** Add `value` when it's missing, remove it when it's there (keeps `allowed` order). */
export function toggleInList<T extends string>(
  list: readonly T[],
  value: T,
  allowed: readonly T[],
): T[] {
  const set = new Set(list);
  if (set.has(value)) set.delete(value);
  else set.add(value);
  return allowed.filter((v) => set.has(v));
}
