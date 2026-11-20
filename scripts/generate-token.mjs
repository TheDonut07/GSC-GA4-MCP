// Generates a strong random access token for one person.
// Usage: node scripts/generate-token.mjs <name>
import { randomBytes } from "node:crypto";

const name = (process.argv[2] ?? "user").replace(/[^a-zA-Z0-9_-]/g, "");
const token = randomBytes(32).toString("base64url");
console.log(`Token for "${name}":\n  ${token}\n`);
console.log(`ACCESS_TOKENS entry:\n  ${name}:${token}\n`);
console.log(`Claude connector settings (after deploy):`);
console.log(`  URL:    https://<your-worker>.workers.dev/mcp`);
console.log(`  Header: Authorization = Bearer ${token}`);
