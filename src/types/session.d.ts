import "express-session";

declare module "express-session" {
  interface SessionData {
    adminId?: number;
    customerId?: number;
    csrfToken?: string;
    /** One-time message shown on the next account page (e.g. "Profile saved"). */
    /** The QR checkout order just submitted, for the thank-you page. */
    lastOrderId?: number;
    flash?: { type: "success" | "error"; message: string };
  }
}
