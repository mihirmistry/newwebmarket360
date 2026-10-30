import nodemailer, { type Transporter } from "nodemailer";
import type pg from "pg";
import type { AppConfig } from "../config.js";
import { decryptSecret, getMailSettings, type MailSettings } from "./settings.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

export type NotifyKind = "order" | "message";

export interface MailStatus {
  /** Where the SMTP details come from: the admin Settings page, the .env file, or nowhere yet. */
  source: "settings" | "env" | "none";
  configured: boolean;
  recipients: string[];
  notifyOrders: boolean;
  notifyMessages: boolean;
  /** A password is saved but can't be decrypted (SESSION_SECRET changed): re-enter it in Settings. */
  passwordUnreadable: boolean;
}

export interface Mailer {
  status(): Promise<MailStatus>;
  /** Emails the configured recipients if this kind of notification is switched on. Resolves false when skipped. */
  notify(kind: NotifyKind, mail: Omit<MailMessage, "to">): Promise<boolean>;
  /** Sends a test email to the recipients; rejects with the SMTP error if it fails. Returns who it went to. */
  sendTest(): Promise<string[]>;
  /** Call after the settings change. */
  invalidate(): void;
}

/** Keeps user-typed values from breaking a header line (nodemailer encodes, this is belt and braces). */
const oneLine = (v: string) => v.replace(/[\r\n]+/g, " ").trim();

interface Resolved {
  status: MailStatus;
  transport: Transporter | null;
  from: string | { name: string; address: string };
}

function transportFor(s: Pick<MailSettings, "host" | "port" | "security" | "user">, pass: string): Transporter {
  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.security === "ssl", // TLS from the start (port 465)
    requireTLS: s.security === "starttls", // upgrade to TLS (port 587)
    ignoreTLS: s.security === "none",
    auth: s.user ? { user: s.user, pass } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

export function createMailer(config: AppConfig, pool: pg.Pool): Mailer {
  let cache: { at: number; value: Resolved } | null = null;

  async function resolve(): Promise<Resolved> {
    if (cache && Date.now() - cache.at < 30_000) return cache.value;
    const saved = await getMailSettings(pool);
    let value: Resolved;
    if (saved) {
      const pass = saved.passEncrypted ? decryptSecret(saved.passEncrypted, config.SESSION_SECRET) : "";
      const configured = Boolean(saved.host && saved.recipients.length && pass !== null);
      value = {
        status: {
          source: "settings",
          configured,
          recipients: saved.recipients,
          notifyOrders: saved.notifyOrders,
          notifyMessages: saved.notifyMessages,
          passwordUnreadable: pass === null,
        },
        transport: configured ? transportFor(saved, pass ?? "") : null,
        from: saved.fromEmail
          ? { name: saved.fromName || "Market360X", address: saved.fromEmail }
          : saved.user && saved.user.includes("@")
            ? { name: saved.fromName || "Market360X", address: saved.user }
            : "no-reply@market360x.com",
      };
    } else if (config.SMTP_HOST && config.ADMIN_EMAIL) {
      value = {
        status: { source: "env", configured: true, recipients: [config.ADMIN_EMAIL], notifyOrders: true, notifyMessages: false, passwordUnreadable: false },
        transport: transportFor(
          { host: config.SMTP_HOST, port: config.SMTP_PORT, security: config.SMTP_SECURE ? "ssl" : "starttls", user: config.SMTP_USER ?? "" },
          config.SMTP_PASS ?? ""
        ),
        from: config.MAIL_FROM ?? config.SMTP_USER ?? "no-reply@market360x.com",
      };
    } else {
      value = {
        status: { source: "none", configured: false, recipients: [], notifyOrders: false, notifyMessages: false, passwordUnreadable: false },
        transport: null,
        from: "no-reply@market360x.com",
      };
    }
    cache = { at: Date.now(), value };
    return value;
  }

  async function send(r: Resolved, mail: Omit<MailMessage, "to">, to: string[]) {
    if (!r.transport) throw new Error("Email isn't set up yet. Add your SMTP details in Settings.");
    await r.transport.sendMail({
      from: r.from,
      to,
      subject: oneLine(mail.subject),
      text: mail.text,
      replyTo: mail.replyTo ? oneLine(mail.replyTo) : undefined,
    });
  }

  return {
    async status() {
      return (await resolve()).status;
    },
    async notify(kind, mail) {
      const r = await resolve();
      const wanted = kind === "order" ? r.status.notifyOrders : r.status.notifyMessages;
      if (!r.status.configured || !wanted) return false;
      await send(r, mail, r.status.recipients);
      return true;
    },
    async sendTest() {
      const r = await resolve();
      if (!r.status.recipients.length) throw new Error("Add at least one email address to receive notifications.");
      await send(
        r,
        {
          subject: "Market360X test email",
          text: [
            "This is a test email from your Market360X admin panel.",
            "",
            "If you can read this, your SMTP settings work and new orders and messages will reach this inbox.",
          ].join("\n"),
        },
        r.status.recipients
      );
      return r.status.recipients;
    },
    invalidate() {
      cache = null;
    },
  };
}
