import "server-only";
import { createHash, scrypt, timingSafeEqual } from "node:crypto";
import { ConfigError } from "./env";

// Must match scripts/hash-password.mjs.
const KEYLEN = 64;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEYLEN, PARAMS, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

// Stored format: scrypt:<salt hex>:<hash hex>
export async function verifyCredentials(
  username: string,
  password: string,
  expected: { username: string; passwordHash: string },
): Promise<boolean> {
  const [scheme, saltHex, hashHex] = expected.passwordHash.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) throw new ConfigError("ADMIN_PASSWORD_HASH 格式错误");

  // Always run the password check so a wrong username costs the same time as a wrong password.
  const userOk = timingSafeEqual(sha256(username), sha256(expected.username));
  const want = Buffer.from(hashHex, "hex");
  const got = await derive(password, Buffer.from(saltHex, "hex"));
  const passOk = want.length === got.length && timingSafeEqual(want, got);
  return userOk && passOk;
}
