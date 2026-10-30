import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type pg from "pg";
import { z } from "zod";

// ---------- encryption for secrets stored in the database (SMTP password) ----------
// AES-256-GCM with a key derived from SESSION_SECRET. If SESSION_SECRET changes, saved secrets
// can no longer be read and the admin is asked to enter them again.

const keyCache = new Map<string, Buffer>();
function keyFor(secret: string): Buffer {
  let key = keyCache.get(secret);
  if (!key) {
    key = scryptSync(secret, "market360x-settings-v1", 32);
    keyCache.set(secret, key);
  }
  return key;
}

export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

/** Returns null when the value can't be decrypted (wrong key or tampered). */
export function decryptSecret(token: string, secret: string): string | null {
  const [version, iv, tag, data] = token.split(".");
  if (version !== "v1" || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFor(secret), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ---------- mail settings ----------

export interface MailSettings {
  host: string;
  port: number;
  /** ssl = TLS from the start (465), starttls = upgrade (587), none = no encryption */
  security: "ssl" | "starttls" | "none";
  user: string;
  /** Encrypted password ("" when none) */
  passEncrypted: string;
  fromName: string;
  fromEmail: string;
  /** Who receives notifications */
  recipients: string[];
  notifyOrders: boolean;
  notifyMessages: boolean;
}

const MAIL_KEY = "mail";
const MAX_RECIPIENTS = 5;
const email = z.string().trim().toLowerCase().email();

const checkbox = z
  .union([z.literal("on"), z.literal("yes"), z.literal("true"), z.literal(""), z.undefined()])
  .transform((v) => v === "on" || v === "yes" || v === "true");

/** The admin Settings form. An empty password keeps the saved one; "clearPassword" removes it. */
export const mailSettingsFormSchema = z
  .object({
    host: z
      .string()
      .trim()
      .max(253)
      .refine((v) => v === "" || /^[a-zA-Z0-9.-]+$/.test(v), "Enter a server name like smtp.gmail.com"),
    port: z.coerce.number({ invalid_type_error: "Enter a port number" }).int("Enter a whole number").min(1, "Enter a port from 1 to 65535").max(65535, "Enter a port from 1 to 65535"),
    security: z.enum(["starttls", "ssl", "none"], { errorMap: () => ({ message: "Choose a security option" }) }),
    user: z.string().trim().max(254),
    password: z.string().max(500),
    clearPassword: checkbox,
    fromName: z.string().trim().max(80),
    fromEmail: z
      .string()
      .trim()
      .toLowerCase()
      .refine((v) => v === "" || email.safeParse(v).success, "Enter a valid email address"),
    recipients: z
      .string()
      .transform((v) => [...new Set(v.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))])
      .superRefine((list, ctx) => {
        const bad = list.find((e) => !email.safeParse(e).success);
        if (bad) ctx.addIssue({ code: "custom", message: `"${bad}" is not a valid email address` });
        else if (list.length > MAX_RECIPIENTS) ctx.addIssue({ code: "custom", message: `Use at most ${MAX_RECIPIENTS} addresses` });
      }),
    notifyOrders: checkbox,
    notifyMessages: checkbox,
  })
  .superRefine((v, ctx) => {
    if (v.host && !v.recipients.length) ctx.addIssue({ code: "custom", path: ["recipients"], message: "Add at least one email address to receive notifications" });
    if (!v.host && v.recipients.length) ctx.addIssue({ code: "custom", path: ["host"], message: "Enter your SMTP server to send emails" });
  });
export type MailSettingsForm = z.infer<typeof mailSettingsFormSchema>;

export async function getMailSettings(db: pg.Pool): Promise<MailSettings | null> {
  const { rows } = await db.query<{ value: MailSettings }>("SELECT value FROM app_settings WHERE key = $1", [MAIL_KEY]);
  return rows[0]?.value ?? null;
}

export async function getSettingsUpdatedAt(db: pg.Pool): Promise<Date | null> {
  const { rows } = await db.query<{ updated_at: Date }>("SELECT updated_at FROM app_settings WHERE key = $1", [MAIL_KEY]);
  return rows[0]?.updated_at ?? null;
}

export async function saveMailSettings(db: pg.Pool, form: MailSettingsForm, secret: string): Promise<MailSettings> {
  const current = await getMailSettings(db);
  const passEncrypted = form.clearPassword ? "" : form.password ? encryptSecret(form.password, secret) : (current?.passEncrypted ?? "");
  const value: MailSettings = {
    host: form.host,
    port: form.port,
    security: form.security,
    user: form.user,
    passEncrypted,
    fromName: form.fromName,
    fromEmail: form.fromEmail,
    recipients: form.recipients,
    notifyOrders: form.notifyOrders,
    notifyMessages: form.notifyMessages,
  };
  await db.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [MAIL_KEY, JSON.stringify(value)]
  );
  return value;
}

// ---------- Angel One SmartAPI (automatic indicators) ----------

export interface AngelOneSettings {
  enabled: boolean;
  clientCode: string;
  /** Encrypted ("" when not saved) */
  apiKeyEncrypted: string;
  pinEncrypted: string;
  totpEncrypted: string;
}

const ANGEL_KEY = "angelone";

/** The admin form. Empty secret fields keep the saved values. */
export const angelOneFormSchema = z.object({
  enabled: checkbox,
  clientCode: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || /^[A-Z0-9]{3,20}$/.test(v), "Enter your Angel One client code (letters and numbers)"),
  apiKey: z
    .string()
    .trim()
    .refine((v) => v === "" || /^[A-Za-z0-9]{4,64}$/.test(v), "The API key is letters and numbers only"),
  pin: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{4,6}$/.test(v), "The PIN is your 4-digit Angel One MPIN"),
  totpSecret: z
    .string()
    .transform((v) => v.replace(/\s+/g, "").toUpperCase())
    .refine((v) => v === "" || /^[A-Z2-7]{16,64}=*$/.test(v), "Paste the text shown under the TOTP QR code (letters A-Z and digits 2-7)"),
});
export type AngelOneForm = z.infer<typeof angelOneFormSchema>;

export async function getAngelOneSettings(db: pg.Pool): Promise<(AngelOneSettings & { updatedAt: Date }) | null> {
  const { rows } = await db.query<{ value: AngelOneSettings; updated_at: Date }>("SELECT value, updated_at FROM app_settings WHERE key = $1", [ANGEL_KEY]);
  return rows[0] ? { ...rows[0].value, updatedAt: rows[0].updated_at } : null;
}

/** Saves the form; returns an error message when turning it on without all four details. */
export async function saveAngelOneSettings(db: pg.Pool, form: AngelOneForm, secret: string): Promise<string | null> {
  const current = await getAngelOneSettings(db);
  const keep = (plain: string, saved: string | undefined) => (plain ? encryptSecret(plain, secret) : (saved ?? ""));
  const value: AngelOneSettings = {
    enabled: form.enabled,
    clientCode: form.clientCode || current?.clientCode || "",
    apiKeyEncrypted: keep(form.apiKey, current?.apiKeyEncrypted),
    pinEncrypted: keep(form.pin, current?.pinEncrypted),
    totpEncrypted: keep(form.totpSecret, current?.totpEncrypted),
  };
  if (value.enabled && !(value.clientCode && value.apiKeyEncrypted && value.pinEncrypted && value.totpEncrypted)) {
    return "Enter the client code, API key, PIN and TOTP secret to turn on automatic indicators.";
  }
  await db.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [ANGEL_KEY, JSON.stringify(value)]
  );
  return null;
}

/** The decrypted login details, or why they can't be used. */
export async function readAngelCredentials(
  db: pg.Pool,
  secret: string
): Promise<{ ok: true; enabled: boolean; creds: import("./angelone.js").AngelCredentials } | { ok: false; reason: string }> {
  const s = await getAngelOneSettings(db);
  if (!s || !s.clientCode || !s.apiKeyEncrypted || !s.pinEncrypted || !s.totpEncrypted) return { ok: false, reason: "Angel One isn't set up yet (Settings → Angel One)." };
  const apiKey = decryptSecret(s.apiKeyEncrypted, secret);
  const pin = decryptSecret(s.pinEncrypted, secret);
  const totpSecret = decryptSecret(s.totpEncrypted, secret);
  if (apiKey === null || pin === null || totpSecret === null) {
    return { ok: false, reason: "The saved Angel One details can no longer be read (the server's secret key changed). Enter them again in Settings." };
  }
  return { ok: true, enabled: s.enabled, creds: { apiKey, clientCode: s.clientCode, pin, totpSecret } };
}
