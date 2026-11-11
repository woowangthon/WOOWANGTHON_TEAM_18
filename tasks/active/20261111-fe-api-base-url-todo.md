# FE API base URL (VITE_API_BASE_URL)

- **SRS**: none (deploy of the static FE to AWS; FE `https://app.stairnoworks.com`, BE `https://api.stairnoworks.com`)
- **Owner**: TaeTaeJin (FE session)
- **Branch**: feat/fe-api-base-url

## Plan

The FE is served as static files from S3 + CloudFront, so a relative `/api/...` no longer reaches the BE. `apiFetch` prefixes an optional `VITE_API_BASE_URL`; empty or unset keeps the relative path, so the Vite dev proxy (`/api` → `localhost:3000`) works as before. Only `apiFetch` builds the URL (`FE/src/lib/api.ts`); the value is read on each call so a test can set it, and a trailing `/` is dropped so `/api/...` does not become `//api/...`. Documented in `FE/.env.example` and typed in `FE/src/vite-env.d.ts` (optional).

The value is baked into the bundle at build time. `Infra/aws/deploy-fe.sh` (PR #105) passes `VITE_API_BASE_URL=https://api.stairnoworks.com` when building. The BE must allow the FE origin in `CORS_ORIGINS`, and the Supabase redirect URLs (#49) are a dashboard task for the user.

## Todo

- [x] Prefix in `apiFetch` (also the retry after 401), env typing, `.env.example`
- [x] Tests: unset, empty, set, trailing `/`, retry uses the same base — `FE/src/lib/api.test.ts`
- [x] Hand mutants (no trailing-slash strip, default value, no prefix)
- [ ] A real request from `app.stairnoworks.com` to `api.stairnoworks.com` (CORS, cookies not used) — needs the deploy
- [ ] Mutation testing (#67 not introduced)

## Done when

The FE built with `VITE_API_BASE_URL` calls the BE at that address, and a build without it still works through the dev proxy.
