// Create an admin account (or reset its password).
// Usage: npm run create-admin -- --email you@example.com
//        (you'll be asked for the password; or set ADMIN_PASSWORD for non-interactive use)
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { MIN_PASSWORD_LENGTH, upsertAdmin } from "../services/admins.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function promptHidden(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

const email = arg("email");
if (!email) {
  console.error("Usage: npm run create-admin -- --email you@example.com");
  process.exit(1);
}

let password = process.env.ADMIN_PASSWORD ?? "";
if (!password) {
  password = await promptHidden(`Password for ${email} (min ${MIN_PASSWORD_LENGTH} characters): `);
  const confirm = await promptHidden("Repeat password: ");
  if (password !== confirm) {
    console.error("Passwords do not match.");
    process.exit(1);
  }
}

const config = loadConfig();
const pool = createPool(config.DATABASE_URL, config.DATABASE_SSL);
try {
  const { admin, created } = await upsertAdmin(pool, email, password);
  console.log(`${created ? "Created" : "Updated password for"} admin ${admin.email}`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
