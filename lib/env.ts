import "server-only";

// Thrown when deployment configuration is missing or malformed. Messages name
// the variable but never echo its value.
export class ConfigError extends Error {}

const LIGHTSAIL_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/;
const AWS_REGION = /^[a-z]{2}(-[a-z]+)+-\d$/;
const CF_ZONE_ID = /^[a-f0-9]{32}$/;
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const USERNAME = /^[A-Za-z0-9_.@-]{1,64}$/;

function read(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!value) throw new ConfigError(`缺少环境变量 ${name}`);
  return value;
}

function matching(name: string, pattern: RegExp, fallback?: string): string {
  const value = read(name, fallback);
  if (!pattern.test(value)) throw new ConfigError(`环境变量 ${name} 格式错误`);
  return value;
}

export function awsConfig() {
  // Credentials (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) are picked up by the SDK itself.
  read("AWS_ACCESS_KEY_ID");
  read("AWS_SECRET_ACCESS_KEY");
  return {
    region: matching("AWS_REGION", AWS_REGION),
    instanceName: matching("LIGHTSAIL_INSTANCE", LIGHTSAIL_NAME),
  };
}

export function cloudflareConfig() {
  const recordNames = read("CF_RECORD_NAMES")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (recordNames.length === 0 || recordNames.length > 10 || !recordNames.every((n) => HOSTNAME.test(n))) {
    throw new ConfigError("环境变量 CF_RECORD_NAMES 格式错误");
  }
  // Hosts whose HTTP traffic is charted; the rest only get DNS query counts.
  // Defaults to every record in CF_RECORD_NAMES.
  const trafficHosts = read("CF_TRAFFIC_HOSTS", recordNames.join(","))
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (trafficHosts.length > 10 || !trafficHosts.every((n) => HOSTNAME.test(n))) {
    throw new ConfigError("环境变量 CF_TRAFFIC_HOSTS 格式错误");
  }
  return {
    token: read("CF_API_TOKEN"),
    zoneId: matching("CF_ZONE_ID", CF_ZONE_ID),
    recordNames,
    trafficHosts,
  };
}

export function authConfig() {
  const sessionSecret = read("SESSION_SECRET");
  if (sessionSecret.length < 32) throw new ConfigError("SESSION_SECRET 至少 32 个字符");
  return {
    username: matching("ADMIN_USERNAME", USERNAME),
    passwordHash: read("ADMIN_PASSWORD_HASH"),
    sessionSecret,
  };
}

export function redisConfig() {
  // Vercel's Upstash integration injects KV_REST_API_*; a manual Upstash setup uses UPSTASH_REDIS_REST_*.
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new ConfigError("缺少 Upstash Redis 环境变量 (KV_REST_API_URL / KV_REST_API_TOKEN)");
  return { url, token };
}
