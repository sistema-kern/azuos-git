/**
 * Returns the absolute base URL of this server.
 * Priority: APP_URL → REPLIT_DOMAINS (first) → REPLIT_DEV_DOMAIN → ""
 * REPLIT_DOMAINS contains the real production domain when deployed.
 */
export function getBaseUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL;
  // REPLIT_DOMAINS: may be comma-separated; first entry is the primary domain
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) {
    const first = domains.split(",")[0].trim();
    if (first) return `https://${first}`;
  }
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) return `https://${devDomain}`;
  return "";
}
