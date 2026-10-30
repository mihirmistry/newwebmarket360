import "dotenv/config";
import { z } from "zod";

const boolFromEnv = z
  .preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.enum(["true", "false", "1", "0"]).optional()
  )
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.coerce.number().int().positive().default(3000)
  ),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_SSL: boolFromEnv,
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  TRUST_PROXY: boolFromEnv,

  // Customer log in / sign up / dashboard. Off for now: plans are bought through the QR checkout instead.
  CUSTOMER_ACCOUNTS: boolFromEnv,

  // QR checkout. With a UPI ID the site draws a QR for each plan's exact amount;
  // otherwise PAYMENT_QR_IMAGE (a file under public/, e.g. /images/payment/upi-qr.png) is shown.
  PAYMENT_UPI_ID: z
    .string()
    .trim()
    .regex(/^[\w.-]{2,256}@[A-Za-z]\w{1,63}$/,"PAYMENT_UPI_ID must look like name@bank")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // The payee name customers' UPI apps show for the QR (defaults match the shipped QR image below).
  PAYMENT_UPI_NAME: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().min(1).max(60).default("Anand Singh")
  ),
  // Defaults to the business QR in public/images/payment; "none" turns it off.
  PAYMENT_QR_IMAGE: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .union([
        z.literal("none").transform(() => undefined),
        z.string().trim().regex(/^\/[\w\-/.]+\.(png|jpe?g|webp|svg)$/i, "PAYMENT_QR_IMAGE must be a path like /images/payment/upi-qr.png"),
      ])
      .default("/images/payment/qr-market360x.webp")
  ),

  // Email: new QR orders are sent to ADMIN_EMAIL. Without SMTP settings, orders are still saved (see /admin/orders).
  ADMIN_EMAIL: z.string().trim().email("ADMIN_EMAIL must be an email address").optional().or(z.literal("").transform(() => undefined)),
  ADMIN_PASSWORD: z.string().trim().min(12, "ADMIN_PASSWORD must be at least 12 characters").optional().or(z.literal("").transform(() => undefined)),
  SMTP_HOST: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
  SMTP_PORT: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.coerce.number().int().positive().default(587)
  ),
  SMTP_SECURE: boolFromEnv,
  SMTP_USER: z.string().optional().or(z.literal("").transform(() => undefined)),
  SMTP_PASS: z.string().optional().or(z.literal("").transform(() => undefined)),
  MAIL_FROM: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\nSee .env.example.`);
  }
  return parsed.data;
}
