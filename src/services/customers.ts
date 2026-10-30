import type pg from "pg";
import { z } from "zod";
import { getDummyHash, hashPassword, verifyPassword } from "../security/password.js";
import {
  EMAIL_MAX,
  PASSWORD_MAX,
  normalizePhone,
  validateEmail,
  validateExperience,
  validateName,
  validateNewPassword,
  validatePhone,
} from "../shared/customer-rules.js";

export interface Customer {
  id: number;
  name: string;
  email: string;
  phone: string;
  experienceYears: number;
  createdAt: Date;
  lastLoginAt: Date | null;
}

// zod refinements reuse the exact browser-side rules so messages match the popup.
const rule = (check: (v: string) => string | undefined) =>
  z.string().superRefine((v, ctx) => {
    const msg = check(v);
    if (msg) ctx.addIssue({ code: "custom", message: msg });
  });

export const signupSchema = z.object({
  name: rule(validateName).transform((v) => v.trim()),
  email: rule(validateEmail).transform((v) => v.trim().toLowerCase()),
  phone: rule(validatePhone).transform(normalizePhone),
  experienceYears: z
    .union([z.string(), z.number()])
    .superRefine((v, ctx) => {
      const msg = validateExperience(v);
      if (msg) ctx.addIssue({ code: "custom", message: msg });
    })
    .transform((v) => Number(v)),
  password: rule(validateNewPassword),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const profileSchema = signupSchema.pick({ name: true, phone: true, experienceYears: true });
export type ProfileInput = z.infer<typeof profileSchema>;

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password").max(PASSWORD_MAX),
    newPassword: rule(validateNewPassword),
    confirmPassword: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.newPassword !== v.confirmPassword) ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "The two new passwords don't match" });
    if (v.newPassword && v.newPassword === v.currentPassword)
      ctx.addIssue({ code: "custom", path: ["newPassword"], message: "Choose a password different from your current one" });
  });

export const loginSchema = z.object({
  email: z.string().trim().min(1, "Enter your email address").max(EMAIL_MAX),
  password: z.string().min(1, "Enter your password").max(PASSWORD_MAX),
});

export class EmailTakenError extends Error {
  constructor() {
    super("An account with this email already exists. Log in instead.");
  }
}

interface Row {
  id: string;
  name: string;
  email: string;
  phone: string;
  experience_years: number;
  created_at: Date;
  last_login_at: Date | null;
}
const toCustomer = (r: Row): Customer => ({
  id: Number(r.id),
  name: r.name,
  email: r.email,
  phone: r.phone,
  experienceYears: r.experience_years,
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at,
});

const COLUMNS = "id, name, email, phone, experience_years, created_at, last_login_at";

export async function createCustomer(db: pg.Pool, input: SignupInput): Promise<Customer> {
  const hash = await hashPassword(input.password);
  try {
    const { rows } = await db.query<Row>(
      `INSERT INTO customers (name, email, phone, experience_years, password_hash, last_login_at)
       VALUES ($1, $2, $3, $4, $5, now())
       RETURNING ${COLUMNS}`,
      [input.name, input.email, input.phone, input.experienceYears, hash]
    );
    return toCustomer(rows[0]!);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new EmailTakenError(); // unique_violation
    throw err;
  }
}

export async function authenticateCustomer(db: pg.Pool, email: string, password: string): Promise<Customer | null> {
  const { rows } = await db.query<Row & { password_hash: string }>(
    `SELECT ${COLUMNS}, password_hash FROM customers WHERE email = $1`,
    [email.trim().toLowerCase()]
  );
  const row = rows[0];
  // Always compare a hash so response time doesn't reveal whether the email is registered.
  const ok = await verifyPassword(password, row?.password_hash ?? (await getDummyHash()));
  if (!row || !ok) return null;
  await db.query("UPDATE customers SET last_login_at = now() WHERE id = $1", [row.id]);
  return toCustomer(row);
}

export async function findCustomerById(db: pg.Pool, id: number): Promise<Customer | null> {
  const { rows } = await db.query<Row>(`SELECT ${COLUMNS} FROM customers WHERE id = $1`, [id]);
  return rows[0] ? toCustomer(rows[0]) : null;
}

export async function updateCustomerProfile(db: pg.Pool, id: number, input: ProfileInput): Promise<Customer | null> {
  const { rows } = await db.query<Row>(
    `UPDATE customers SET name = $2, phone = $3, experience_years = $4, updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, input.name, input.phone, input.experienceYears]
  );
  return rows[0] ? toCustomer(rows[0]) : null;
}

/** Checks the current password, stores the new one and signs the customer out everywhere else. */
export async function changeCustomerPassword(
  db: pg.Pool,
  id: number,
  currentPassword: string,
  newPassword: string,
  keepSessionId: string
): Promise<boolean> {
  const { rows } = await db.query<{ password_hash: string }>("SELECT password_hash FROM customers WHERE id = $1", [id]);
  if (!rows[0] || !(await verifyPassword(currentPassword, rows[0].password_hash))) return false;
  const hash = await hashPassword(newPassword);
  await db.query("UPDATE customers SET password_hash = $2, updated_at = now() WHERE id = $1", [id, hash]);
  await db.query("DELETE FROM user_sessions WHERE (sess ->> 'customerId') = $1 AND sid <> $2", [String(id), keepSessionId]);
  return true;
}
