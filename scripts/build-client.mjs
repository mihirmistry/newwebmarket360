// Bundle the browser scripts (src/client/*.ts, which share src/shared with the server) into public/js.
import { build } from "esbuild";

const watch = process.argv.includes("--watch");
const options = {
  entryPoints: ["src/client/dashboard.ts", "src/client/indicator.ts", "src/client/auth.ts", "src/client/admin.ts", "src/client/account.ts", "src/client/account-menu.ts", "src/client/ticker.ts", "src/client/admin-shell.ts", "src/client/theme.ts", "src/client/checkout.ts", "src/client/search.ts", "src/client/stack.ts", "src/client/tabs.ts", "src/client/showcase.ts", "src/client/index-chart.ts", "src/client/terminal-cards.ts", "src/client/boot.ts", "src/client/admin-tabs.ts"],
  outdir: "public/js",
  bundle: true,
  format: "iife",
  target: ["es2019"],
  minify: !watch,
  sourcemap: true,
  logLevel: "info",
};

if (watch) {
  const { context } = await import("esbuild");
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
