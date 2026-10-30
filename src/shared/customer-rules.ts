// Sign-up / log-in validation shared by the auth popup (browser) and the account API (server).
export const NAME_MIN = 2;
export const NAME_MAX = 80;
export const EMAIL_MAX = 254;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;
export const EXPERIENCE_MAX = 60;

export type CustomerField = "name" | "email" | "phone" | "experienceYears" | "password";

/** Remove spaces, dashes, dots and brackets: "+91 98765-43210" -> "+919876543210". */
export function normalizePhone(raw: string): string {
  return raw.trim().replace(/[\s\-().]/g, "");
}

export function validateName(v: string): string | undefined {
  const t = v.trim();
  if (t.length < NAME_MIN) return "Enter your full name";
  if (t.length > NAME_MAX) return `Use ${NAME_MAX} characters or fewer`;
  return undefined;
}

export function validateEmail(v: string): string | undefined {
  const t = v.trim();
  if (!t) return "Enter your email address";
  if (t.length > EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return "Enter a valid email address";
  return undefined;
}

export function validatePhone(v: string): string | undefined {
  const p = normalizePhone(v);
  if (!p) return "Enter your mobile number";
  if (!/^\+?[0-9]{10,15}$/.test(p)) return "Enter a valid mobile number (10 to 15 digits)";
  return undefined;
}

export function validateExperience(v: string | number): string | undefined {
  const s = String(v).trim();
  if (s === "") return "Enter your years of market experience";
  if (!/^\d{1,2}$/.test(s) || Number(s) > EXPERIENCE_MAX) return `Enter a whole number from 0 to ${EXPERIENCE_MAX}`;
  return undefined;
}

/** UPI transaction ID / UTR as typed ("4152 6378 9012") -> "415263789012". */
export function normalizePaymentRef(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/** Checkout: the UPI transaction ID is required so the admin can match the payment. */
export function validatePaymentRef(v: string): string | undefined {
  const ref = normalizePaymentRef(v);
  if (!ref) return "Enter the UPI transaction ID (UTR) from your payment receipt";
  if (!/^[A-Z0-9]{6,40}$/.test(ref)) return "Use the 6 to 40 letter/number reference from your UPI app";
  return undefined;
}

export interface PasswordRule {
  id: "length" | "upper" | "number" | "symbol";
  label: string;
  missing: string;
  test: (v: string) => boolean;
}

/** New-password rules, shown as a checklist in the sign-up popup and enforced by the server. */
export const PASSWORD_RULES: readonly PasswordRule[] = [
  { id: "length", label: `At least ${PASSWORD_MIN} characters`, missing: `at least ${PASSWORD_MIN} characters`, test: (v) => v.length >= PASSWORD_MIN },
  { id: "upper", label: "One capital letter (A-Z)", missing: "a capital letter", test: (v) => /[A-Z]/.test(v) },
  { id: "number", label: "One number (0-9)", missing: "a number", test: (v) => /[0-9]/.test(v) },
  { id: "symbol", label: "One symbol (e.g. ! @ # $)", missing: "a symbol", test: (v) => /[^A-Za-z0-9s]/.test(v) },
];

export const STRENGTH_LABELS = ["", "Weak", "Fair", "Good", "Strong"] as const;

/** 0 (empty) to 4 (all rules met). A password shorter than the minimum is never more than "Weak". */
export function passwordStrength(v: string): 0 | 1 | 2 | 3 | 4 {
  if (!v) return 0;
  const met = PASSWORD_RULES.filter((r) => r.test(v)).length;
  const score = v.length < PASSWORD_MIN ? Math.min(met, 1) : met;
  return Math.max(score, 1) as 1 | 2 | 3 | 4;
}

export function validateNewPassword(v: string): string | undefined {
  if (v.length > PASSWORD_MAX) return `Use ${PASSWORD_MAX} characters or fewer`;
  const missing = PASSWORD_RULES.filter((r) => !r.test(v)).map((r) => r.missing);
  if (!missing.length) return undefined;
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  return `Password needs ${list}`;
}
