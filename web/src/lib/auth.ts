// Single-user gate. The cookie holds a digest of CHALK_PASSWORD, so the
// password itself never travels back to the browser and the middleware can
// verify it on the edge with Web Crypto.

export const SESSION_COOKIE = "chalk_session";

export async function sessionToken(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`chalk.v1:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
