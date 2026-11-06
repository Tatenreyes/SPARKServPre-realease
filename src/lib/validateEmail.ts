/**
 * Address checks for the sign-up and log-in forms.
 *
 * Deliberately shallow: the only authority on whether an address exists is the
 * mail server, so this rejects what is obviously wrong (a broken shape, a
 * placeholder someone typed to get past the form, a mistyped provider) and lets
 * everything else through to Supabase. It never blocks a plausible address.
 */
export const INVALID_EMAIL_MESSAGE = "Enter a valid email address";

/** Shape only: something, one @, a domain, and a TLD of at least two letters. */
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Local parts that are placeholders rather than a person. */
const PLACEHOLDER_LOCAL_PARTS = new Set([
  "example",
  "test",
  "tester",
  "sample",
  "abc",
  "abcd",
  "asdf",
  "qwerty",
  "email",
  "name",
  "user",
  "username",
  "fake",
  "demo",
  "admin123",
  "123",
  "1234",
  "12345",
]);

/** Domains that resolve, but never to an inbox somebody reads. */
const PLACEHOLDER_DOMAINS = new Set(["example.com", "test.com"]);

/**
 * The domains people actually mistype, mapped to the one they meant. Exported so
 * the "Did you mean ...?" hint and the validation below read the same list, and
 * a typo can never be refused without being offered a fix.
 */
export const EMAIL_DOMAIN_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gmail.con": "gmail.com",
  "gnail.com": "gmail.com",
  "gmai.com": "gmail.com",
  "yahho.com": "yahoo.com",
  "hotmial.com": "hotmail.com",
};

/** `name@gmial.com` -> `name@gmail.com`, or null when nothing looks mistyped. */
export function suggestEmailFix(email: string): string | null {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at < 1) return null;
  const fixed = EMAIL_DOMAIN_TYPOS[value.slice(at + 1)];
  if (!fixed) return null;
  return `${value.slice(0, at)}@${fixed}`;
}

/**
 * The message to show, or null when the address is worth sending to Supabase.
 * Normalised first, so `  Name@Gmail.COM  ` is judged as `name@gmail.com`.
 */
export function validateEmail(email: string): string | null {
  const value = email.trim().toLowerCase();

  if (!EMAIL_FORMAT.test(value)) return INVALID_EMAIL_MESSAGE;

  // The format check guarantees exactly one "@", so this split cannot surprise.
  const [localPart, domain] = value.split("@");
  if (PLACEHOLDER_LOCAL_PARTS.has(localPart)) return INVALID_EMAIL_MESSAGE;
  if (PLACEHOLDER_DOMAINS.has(domain)) return INVALID_EMAIL_MESSAGE;
  if (EMAIL_DOMAIN_TYPOS[domain]) return INVALID_EMAIL_MESSAGE;

  return null;
}
