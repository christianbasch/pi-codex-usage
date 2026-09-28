/** Advances to the next option in a list, wrapping around. */
export function cycle<T>(options: readonly T[], current: T): T {
  return options[(options.indexOf(current) + 1) % options.length]!;
}

/** Cycles an id-based option list by its current id. */
export function cycleOption<T>(
  options: ReadonlyArray<{ id: T }>,
  current: T
): T {
  const index = options.findIndex((option) => option.id === current);
  return options[(index + 1) % options.length]!.id;
}
