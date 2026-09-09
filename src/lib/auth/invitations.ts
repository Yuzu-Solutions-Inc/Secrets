import "server-only";

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
