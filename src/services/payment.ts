import QRCode from "qrcode";
import type { AppConfig } from "../config.js";
import type { Plan } from "../site/plans.js";

export interface PaymentDetails {
  /** "upi": QR drawn for the exact amount; "image": a fixed QR image; "none": not set up yet. */
  mode: "upi" | "image" | "none";
  upiId?: string;
  payee?: string;
  /** upi://pay link (also opens UPI apps when tapped on a phone) */
  link?: string;
  /** Inline SVG markup of the QR (mode "upi") */
  qrSvg?: string;
  /** Image path (mode "image") */
  qrImage?: string;
}

/** Standard UPI deep link (NPCI "upi://pay") with the plan's amount filled in. */
export function upiLink(upiId: string, payee: string, plan: Plan): string {
  const params = new URLSearchParams({
    pa: upiId,
    pn: payee,
    am: plan.price.toFixed(2),
    cu: "INR",
    tn: `Market360X ${plan.name} plan`,
  });
  // URLSearchParams encodes spaces as "+", which some UPI apps show literally; use %20.
  return `upi://pay?${params.toString().replace(/\+/g, "%20")}`;
}

const svgCache = new Map<string, string>();

export async function paymentDetails(config: AppConfig, plan: Plan): Promise<PaymentDetails> {
  if (config.PAYMENT_UPI_ID) {
    const link = upiLink(config.PAYMENT_UPI_ID, config.PAYMENT_UPI_NAME, plan);
    let qrSvg = svgCache.get(link);
    if (!qrSvg) {
      qrSvg = await QRCode.toString(link, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#111827", light: "#ffffff" } });
      svgCache.set(link, qrSvg);
    }
    return { mode: "upi", upiId: config.PAYMENT_UPI_ID, payee: config.PAYMENT_UPI_NAME, link, qrSvg };
  }
  if (config.PAYMENT_QR_IMAGE) return { mode: "image", qrImage: config.PAYMENT_QR_IMAGE, payee: config.PAYMENT_UPI_NAME };
  return { mode: "none" };
}
