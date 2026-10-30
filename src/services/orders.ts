import type pg from "pg";
import { z } from "zod";
import {
  normalizePaymentRef,
  normalizePhone,
  validateEmail,
  validateExperience,
  validateName,
  validatePaymentRef,
  validatePhone,
} from "../shared/customer-rules.js";
import type { Plan } from "../site/plans.js";

const check = (fn: (v: string) => string | undefined) =>
  z.string().superRefine((v, ctx) => {
    const msg = fn(v);
    if (msg) ctx.addIssue({ code: "custom", message: msg });
  });

/** The QR checkout form. */
export const orderSchema = z.object({
  name: check(validateName).transform((v) => v.trim()),
  email: check(validateEmail).transform((v) => v.trim().toLowerCase()),
  phone: check(validatePhone).transform(normalizePhone),
  experienceYears: check(validateExperience).transform((v) => Number(v)),
  // Required UPI transaction / UTR number: the admin matches it against the bank statement.
  paymentRef: check(validatePaymentRef).transform(normalizePaymentRef),
  paid: z.literal("yes", { errorMap: () => ({ message: "Please pay using the QR code, then tick this box" }) }),
});
export type OrderInput = z.infer<typeof orderSchema>;

export interface PlanOrder {
  id: number;
  planId: string;
  planName: string;
  amount: number;
  name: string;
  email: string;
  phone: string;
  experienceYears: number;
  paymentRef: string | null;
  status: "new" | "done";
  adminNotifiedAt: Date | null;
  createdAt: Date;
}

interface Row {
  id: string;
  plan_id: string;
  plan_name: string;
  amount: number;
  name: string;
  email: string;
  phone: string;
  experience_years: number;
  payment_ref: string | null;
  status: "new" | "done";
  admin_notified_at: Date | null;
  created_at: Date;
}
const COLUMNS = "id, plan_id, plan_name, amount, name, email, phone, experience_years, payment_ref, status, admin_notified_at, created_at";
const toOrder = (r: Row): PlanOrder => ({
  id: Number(r.id),
  planId: r.plan_id,
  planName: r.plan_name,
  amount: r.amount,
  name: r.name,
  email: r.email,
  phone: r.phone,
  experienceYears: r.experience_years,
  paymentRef: r.payment_ref,
  status: r.status,
  adminNotifiedAt: r.admin_notified_at,
  createdAt: r.created_at,
});

/** The amount always comes from the server-side plan, never from the form. */
export async function createOrder(db: pg.Pool, plan: Plan, input: OrderInput): Promise<PlanOrder> {
  const { rows } = await db.query<Row>(
    `INSERT INTO plan_orders (plan_id, plan_name, amount, name, email, phone, experience_years, payment_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLUMNS}`,
    [plan.id, plan.name, plan.price, input.name, input.email, input.phone, input.experienceYears, input.paymentRef]
  );
  return toOrder(rows[0]!);
}

export async function findOrder(db: pg.Pool, id: number): Promise<PlanOrder | null> {
  const { rows } = await db.query<Row>(`SELECT ${COLUMNS} FROM plan_orders WHERE id = $1`, [id]);
  return rows[0] ? toOrder(rows[0]) : null;
}

export async function listOrders(db: pg.Pool, limit = 200): Promise<PlanOrder[]> {
  const { rows } = await db.query<Row>(
    `SELECT ${COLUMNS} FROM plan_orders ORDER BY (status = 'new') DESC, created_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map(toOrder);
}

export async function markOrderNotified(db: pg.Pool, id: number): Promise<void> {
  await db.query("UPDATE plan_orders SET admin_notified_at = now() WHERE id = $1", [id]);
}

export async function setOrderStatus(db: pg.Pool, id: number, status: "new" | "done"): Promise<boolean> {
  const { rowCount } = await db.query("UPDATE plan_orders SET status = $2 WHERE id = $1", [id, status]);
  return (rowCount ?? 0) > 0;
}

export async function deleteOrder(db: pg.Pool, id: number): Promise<boolean> {
  const { rowCount } = await db.query("DELETE FROM plan_orders WHERE id = $1", [id]);
  return (rowCount ?? 0) > 0;
}

/** Plain-text email to the admin about a new order. */
export function orderEmail(order: PlanOrder, adminUrl: string, formatInr: (n: number) => string) {
  const experience = order.experienceYears === 0 ? "Less than a year" : `${order.experienceYears} year${order.experienceYears === 1 ? "" : "s"}`;
  return {
    subject: `New order #${order.id}: ${order.planName} plan (${formatInr(order.amount)}) - ${order.name}`,
    text: [
      `A customer has submitted the QR checkout form.`,
      ``,
      `Order:        #${order.id}`,
      `Plan:         Nifty Option Alert - ${order.planName} (${formatInr(order.amount)})`,
      `Payment ref:  ${order.paymentRef ?? "not given"}`,
      ``,
      `Name:         ${order.name}`,
      `Email:        ${order.email}`,
      `Mobile:       ${order.phone}`,
      `Experience:   ${experience} in the market`,
      ``,
      `Next steps: check the payment of ${formatInr(order.amount)} in your UPI app, create the customer's login,`,
      `email the credentials to ${order.email} within 24 hours, then mark the order done:`,
      adminUrl,
    ].join("\n"),
  };
}
