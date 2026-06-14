// Resolves the PartyKit host: a dev override, the local dev server in
// development, or the same origin in production.
export function partyHost(): string {
  const override = import.meta.env.VITE_PARTY_HOST as string | undefined;
  if (override) return override;
  if (import.meta.env.DEV) return `${location.hostname}:1999`;
  return location.host;
}
