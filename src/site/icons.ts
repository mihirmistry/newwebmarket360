// Lucide icons (lucide-static), rendered inline by the server: views call <%- icon("mail") %>.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ICON_DIR = path.dirname(createRequire(import.meta.url).resolve("lucide-static/icons/eye.svg"));
const cache = new Map<string, string>();

/** Returns the icon's inner SVG markup (paths, circles...), cached after the first read. */
function iconBody(name: string): string {
  let body = cache.get(name);
  if (body === undefined) {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Invalid icon name: ${name}`);
    const svg = fs.readFileSync(path.join(ICON_DIR, `${name}.svg`), "utf8");
    body = svg.slice(svg.indexOf(">", svg.indexOf("<svg")) + 1, svg.lastIndexOf("</svg>")).trim();
    cache.set(name, body);
  }
  return body;
}

/** Decorative inline SVG icon; give the surrounding control its accessible name. */
export function icon(name: string, className = ""): string {
  const cls = ["m3x-icon", `lucide-${name}`, className].filter(Boolean).join(" ");
  return (
    `<svg class="${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${iconBody(name)}</svg>`
  );
}
