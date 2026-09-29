# lightkeeper

A small admin panel on Vercel for one AWS Lightsail instance and its Cloudflare DNS records.

- Instance status and 1/3/7-day CPU, network, and status-check metrics
- Lightsail operation log
- One-click reboot
- Cloudflare traffic (requests / bytes) for `a.picone.asia` and `b.picone.asia`
- One-click static IP rotation, with DNS update

All AWS and Cloudflare calls run in server-side route handlers. Secrets live only in Vercel
environment variables. Every `lib/` module imports `server-only`, so importing one from a client
component fails the build.

## IP rotation

`POST /api/lightsail/rotate-ip` runs these steps and stops at the first Lightsail failure:

1. Validate configuration
2. Read the static IPs
3. Detach the IP currently attached to the instance (initially `StaticIp-1`)
4. Release (delete) it
5. Allocate `StaticIp-<timestamp>`
6. Attach it to the instance
7. Confirm the attachment and read the new address
8. PATCH the A records in `CF_RECORD_NAMES` (TTL and proxied settings are kept)

A static IP that is allocated but not attached is billed. If step 4, 6, or 7 fails, the response
and the UI say which IP was left unattached. The dashboard also warns whenever any unattached
static IP exists. A Redis lock stops two rotations from running at the same time.

## Login

- Single admin user: `ADMIN_USERNAME` plus an scrypt hash in `ADMIN_PASSWORD_HASH`
- 5 failed attempts for a username **or** an IP lock logins for 15 minutes. The counters are stored in
  Upstash Redis, so the lock holds across serverless instances.
- The session is an HMAC-signed cookie (`HttpOnly`, `Secure`, `SameSite=Strict`) that lasts 365 days.
  To sign everyone out, rotate `SESSION_SECRET`.
- Write endpoints also check that the `Origin` header matches the host.

Note: someone who knows the username can lock you out for 15 minutes by sending wrong passwords.
Use a username that isn't easy to guess.

## Setup

1. **AWS**: create an IAM user with [iam-policy.json](iam-policy.json) and generate an access key for it.
2. **Cloudflare**: create an API token for the `picone.asia` zone with the `Zone → DNS → Edit` and
   `Zone → Analytics → Read` permissions. Copy the zone ID from the zone overview page.
3. **Password hash**:
   ```bash
   npm run hash-password
   ```
4. **Session secret**:
   ```bash
   openssl rand -hex 32
   ```
5. **Vercel**: import the repo. Add Upstash Redis from Vercel Marketplace (Storage tab); this injects
   `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Then set the rest of the variables from [.env.example](.env.example).

Cloudflare only records traffic for proxied (orange-cloud) records. For DNS-only records, the traffic
charts stay empty.

## Local development

```bash
npm install
vercel env pull .env.local
npm run dev
```
