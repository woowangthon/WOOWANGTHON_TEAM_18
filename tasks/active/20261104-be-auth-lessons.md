# BE login token verification — lessons

## Log

- 2026-11-04: Why id/pw (from TaeTaeJin): with GitHub OAuth the judges' test account would be one of our GitHub accounts — handing over credentials and hitting 2FA. Ownership is checked through a GitHub account linked afterwards. Supabase project is ready; its public key set has one key, EC P-256 / ES256.
- 2026-11-04: `grep` for the old wording found ADR-002 also decided "student login = GitHub OAuth, compare the logged-in account". ADR-007 now supersedes that item too; ADR-002 got only a status-line change, per the ADR rules.
- 2026-11-04: Diagram text changed in both the embedded mxfile and the rendered SVG; checked by rendering with headless Chromium. The PNG previews embedded in the two `.drawio.svg` files still show the old text until someone re-saves them in draw.io.
- 2026-11-04: Read jose's `jwks/remote.js` before mapping errors: a non-200 or non-JSON key-set response throws a bare `JOSEError` (`ERR_JOSE_GENERIC`), not `JWKSTimeout`. The plan's "every JOSE error except timeout → 401" would have reported a Supabase outage as a bad token. The 503 set is `ERR_JOSE_GENERIC`, `ERR_JWKS_TIMEOUT`, `ERR_JWKS_INVALID`, plus non-JOSE errors (fetch's `TypeError`).
- 2026-11-04: Tests stub the global `fetch` instead of overriding a JWKS provider, so they run the real `createRemoteJWKSet` (URL, caching, error types) and the guard needs no extra provider token.
- 2026-11-04: Hand-made mutants on the guard: 17 run. Survivors were "drop `algorithms`" and "add HS256 to `algorithms`" — equivalent, because jose only picks keys whose type fits the token's `alg` and a public key set holds no HMAC key; `none` is always refused. The option was removed (the HS256 / `none` tests stay). "Any `app_metadata.role` is admin" and a loose `Bearer` regex survived for lack of tests; tests added, then killed (plus anchor and case mutants).
- 2026-11-04: `/simplify` (4 reviewers): applied — the test token helper builds one default payload and merges overrides (`undefined` drops a claim) instead of 7 options and a `null` flag; the test issuer is read from `process.env.SUPABASE_URL` instead of a second copy; the 503 code set uses jose's `errors.X.code` instead of string literals. Skipped — a longer `cacheMaxAge` / shorter `timeoutDuration` (tuning away from library defaults with no measured need); `APP_FILTER` instead of `setupApp` (style only, every app goes through `setupApp`); `!value` in `env.ts` (kept like `PORT`). Mutants re-run after the test rewrite: all killed.
- 2026-11-04: `/code-review` at low effort: no code bugs; one doc gap — `auth.md`'s error table named only `sub` as required while the guard also requires `email` (a phone-only or anonymous token gets 401). Fixed in the auth commit.
- 2026-11-04: Live against the real project (local and in the container): no token → 401 `AUTH_REQUIRED`; a token with the real `kid` signed by our key → 401 `INVALID_TOKEN`, which needs the real key set to have been fetched; unreachable auth server → 503; no `SUPABASE_URL` → boot stops.

## Lessons

- Read the library's error paths before mapping its errors to status codes; class names alone (`JWKSTimeout`) suggested a split the code does not make.
- Stub at the I/O edge (`fetch`) rather than replacing the component, so the test also covers how the component is wired.
- A security option that a mutant shows to be equivalent is still dead code; keep the test that proves the attack fails, drop the option.
