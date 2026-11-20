export interface Env {
  /** Full JSON key file of the Google service account (secret). */
  GOOGLE_SERVICE_ACCOUNT_JSON: string;
  /**
   * Who may use the server (secret). Comma-separated `name:token` pairs, e.g.
   *   "owner:3f9c...a1,partner:77d2...e0"
   * Each person connects with their own token, so access can be revoked per person.
   */
  ACCESS_TOKENS: string;
  /** Optional default Search Console site, e.g. "sc-domain:example.com". */
  DEFAULT_GSC_SITE?: string;
  /** Optional default GA4 property ID, e.g. "123456789". */
  DEFAULT_GA4_PROPERTY?: string;
}
