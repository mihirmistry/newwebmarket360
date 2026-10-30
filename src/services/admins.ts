import type pg from "pg";
import { getDummyHash, hashPassword, verifyPassword } from "../security/password.js";

export interface AdminUser {
  id: number;
  email: string;
}

export const MIN_PASSWORD_LENGTH = 12;

export async function findAdminById(db: pg.Pool, id: number): Promise<AdminUser | null> {
  const { rows } = await db.query<{ id: string; email: string }>("SELECT id, email FROM admin_users WHERE id = $1", [id]);
  return rows[0] ? { id: Number(rows[0].id), email: rows[0].email } : null;
}

/** Returns the admin when the email/password pair is valid, otherwise null. */
export async function authenticateAdmin(db: pg.Pool, email: string, password: string): Promise<AdminUser | null> {
  const { rows } = await db.query<{ id: string; email: string; password_hash: string }>(
    "SELECT id, email, password_hash FROM admin_users WHERE email = $1",
    [email.trim().toLowerCase()]
  );
  const row = rows[0];
  // Always run a hash comparison so response time does not reveal whether the email exists.
  const ok = await verifyPassword(password, row?.password_hash ?? (await getDummyHash()));
  if (!row || !ok) return null;
  await db.query("UPDATE admin_users SET last_login_at = now() WHERE id = $1", [row.id]);
  return { id: Number(row.id), email: row.email };
}

/** Creates an admin, or resets the password if the email already exists. */
export async function upsertAdmin(db: pg.Pool, email: string, password: string): Promise<{ admin: AdminUser; created: boolean }> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("Enter a valid email address");
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  const hash = await hashPassword(password);
  const { rows } = await db.query<{ id: string; email: string; created: boolean }>(
    `INSERT INTO admin_users (email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()
     RETURNING id, email, (xmax = 0) AS created`,
    [normalized, hash]
  );
  const row = rows[0]!;
  return { admin: { id: Number(row.id), email: row.email }, created: row.created };
}
