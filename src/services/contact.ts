import type pg from "pg";
import { z } from "zod";
import { normalizePhone, validateEmail, validateName, validatePhone } from "../shared/customer-rules.js";

export const CONTACT_TOPICS = [
  { id: "plans", label: "Plans and pricing" },
  { id: "activate", label: "Activate my plan / payment" },
  { id: "alerts", label: "Alerts and the dashboard" },
  { id: "account", label: "My account" },
  { id: "partnership", label: "Partnership" },
  { id: "other", label: "Something else" },
] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number]["id"];
const TOPIC_IDS = CONTACT_TOPICS.map((t) => t.id) as [ContactTopic, ...ContactTopic[]];
export const topicLabel = (id: string) => CONTACT_TOPICS.find((t) => t.id === id)?.label ?? id;

export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 2000;

const check = (fn: (v: string) => string | undefined) =>
  z.string().superRefine((v, ctx) => {
    const msg = fn(v);
    if (msg) ctx.addIssue({ code: "custom", message: msg });
  });

export const contactSchema = z.object({
  name: check(validateName).transform((v) => v.trim()),
  email: check(validateEmail).transform((v) => v.trim().toLowerCase()),
  // Optional: empty means "not given".
  phone: z
    .string()
    .superRefine((v, ctx) => {
      const msg = v.trim() ? validatePhone(v) : undefined;
      if (msg) ctx.addIssue({ code: "custom", message: msg });
    })
    .transform((v) => (v.trim() ? normalizePhone(v) : null)),
  topic: z.enum(TOPIC_IDS, { errorMap: () => ({ message: "Choose what your message is about" }) }),
  message: z
    .string()
    .transform((v) => v.trim())
    .pipe(
      z
        .string()
        .min(MESSAGE_MIN, `Write at least ${MESSAGE_MIN} characters so we can help`)
        .max(MESSAGE_MAX, `Keep your message under ${MESSAGE_MAX} characters`)
    ),
});
export type ContactInput = z.infer<typeof contactSchema>;

export interface ContactMessage {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  topic: string;
  message: string;
  customerId: number | null;
  status: "new" | "handled";
  createdAt: Date;
}

interface Row {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  topic: string;
  message: string;
  customer_id: string | null;
  status: "new" | "handled";
  created_at: Date;
}
const toMessage = (r: Row): ContactMessage => ({
  id: Number(r.id),
  name: r.name,
  email: r.email,
  phone: r.phone,
  topic: r.topic,
  message: r.message,
  customerId: r.customer_id === null ? null : Number(r.customer_id),
  status: r.status,
  createdAt: r.created_at,
});

export async function createContactMessage(db: pg.Pool, input: ContactInput, customerId: number | null): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO contact_messages (name, email, phone, topic, message, customer_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [input.name, input.email, input.phone, input.topic, input.message, customerId]
  );
  return Number(rows[0]!.id);
}

export async function listContactMessages(db: pg.Pool, limit = 200): Promise<ContactMessage[]> {
  const { rows } = await db.query<Row>(
    `SELECT id, name, email, phone, topic, message, customer_id, status, created_at
     FROM contact_messages ORDER BY (status = 'new') DESC, created_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map(toMessage);
}

export async function setContactMessageStatus(db: pg.Pool, id: number, status: "new" | "handled"): Promise<boolean> {
  const { rowCount } = await db.query("UPDATE contact_messages SET status = $2 WHERE id = $1", [id, status]);
  return (rowCount ?? 0) > 0;
}

export async function deleteContactMessage(db: pg.Pool, id: number): Promise<boolean> {
  const { rowCount } = await db.query("DELETE FROM contact_messages WHERE id = $1", [id]);
  return (rowCount ?? 0) > 0;
}

/** Plain-text email to the admin about a new Contact page message. */
export function contactEmail(id: number, input: ContactInput, adminUrl: string) {
  return {
    subject: `New message #${id} (${topicLabel(input.topic)}) - ${input.name}`,
    text: [
      `Someone sent a message from the Contact page.`,
      ``,
      `From:    ${input.name}`,
      `Email:   ${input.email}`,
      `Mobile:  ${input.phone ?? "not given"}`,
      `Topic:   ${topicLabel(input.topic)}`,
      ``,
      input.message,
      ``,
      `Reply to this email to answer them, or see all messages: ${adminUrl}`,
    ].join("\n"),
  };
}
