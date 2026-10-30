// Nifty Option Alert plans. The checkout always takes prices from here (never from the browser).
export type PlanId = "weekly" | "monthly" | "yearly";

export interface Plan {
  id: PlanId;
  name: string;
  /** Price in whole rupees */
  price: number;
  /** "week" | "month" | "year" */
  period: "week" | "month" | "year";
  /** Number of weeks the plan covers, for the per-week comparison */
  weeks: number;
  validity: string;
}

export const WEEKLY_BASE_PRICE = 99;

export const PLANS: readonly Plan[] = [
  { id: "weekly", name: "Weekly", price: 99, period: "week", weeks: 1, validity: "7 days" },
  { id: "monthly", name: "Monthly", price: 299, period: "month", weeks: 4, validity: "1 month" },
  { id: "yearly", name: "Yearly", price: 2499, period: "year", weeks: 52, validity: "12 months" },
];

export function findPlan(id: unknown): Plan | undefined {
  return typeof id === "string" ? PLANS.find((p) => p.id === id) : undefined;
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
export const formatInr = (amount: number): string => inr.format(amount);

/** Per-week cost and saving against paying the weekly price every week. */
export function planComparison(plan: Plan): { perWeek: number; fullPrice: number; saving: number; savingPercent: number } {
  const fullPrice = WEEKLY_BASE_PRICE * plan.weeks;
  const saving = fullPrice - plan.price;
  return {
    perWeek: Math.round(plan.price / plan.weeks),
    fullPrice,
    saving,
    savingPercent: fullPrice > 0 ? Math.floor((saving / fullPrice) * 100) : 0,
  };
}
