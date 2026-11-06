// Practice fixture: one intentional bug. Prices are integer cents.
// Inputs: an array of { priceCents, quantity }, both non-negative integers.
export function totalCents(items) {
  return items.reduce((sum, item) => sum + item.priceCents, 0);
}
