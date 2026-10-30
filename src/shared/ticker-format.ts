// Number formats for the header index strip, shared by the server render and the browser refresh.
const price = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatIndexPrice = (n: number): string => price.format(n);

/** "+148.80 (+0.65%)" / "−5.20 (−0.04%)" with a real minus sign. */
export function formatIndexChange(change: number, changePercent: number): string {
  const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");
  return `${sign(change)}${price.format(Math.abs(change))} (${sign(changePercent)}${Math.abs(changePercent).toFixed(2)}%)`;
}

export const directionArrow = (d: "up" | "down" | "flat"): string => (d === "up" ? "▲" : d === "down" ? "▼" : "◆");
