// Generates ADMIN_PASSWORD_HASH. Reads the password from a hidden prompt (or stdin),
// never from argv, so it does not land in shell history.
import { randomBytes, scryptSync } from "node:crypto";

// Must match lib/password.ts.
const KEYLEN = 64;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

async function readHidden(prompt) {
  if (!process.stdin.isTTY) {
    let data = "";
    for await (const chunk of process.stdin) data += chunk;
    return data.replace(/\r?\n$/, "");
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let buf = "";
    const done = (fn) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
      process.stdout.write("\n");
      fn();
    };
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === "\r" || c === "\n") return done(() => resolve(buf));
        if (c === "\u0003") return done(() => reject(new Error("cancelled")));
        if (c === "\u007f" || c === "\b") buf = buf.slice(0, -1);
        else buf += c;
      }
    };
    process.stdin.on("data", onData);
  });
}

const password = await readHidden("Password: ");
if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}
if (process.stdin.isTTY && (await readHidden("Repeat:   ")) !== password) {
  console.error("Passwords do not match.");
  process.exit(1);
}

const salt = randomBytes(16);
const hash = scryptSync(password, salt, KEYLEN, PARAMS);
console.log(`scrypt:${salt.toString("hex")}:${hash.toString("hex")}`);
