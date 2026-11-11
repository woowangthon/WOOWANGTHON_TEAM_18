# FE API base URL — lessons

## Log

- 2026-11-11: Started from `upstream/main` 41a72aa. The user approved this PR in the session (it was proposed as optional).
- 2026-11-11: The first two new tests failed because `mockResolvedValue(json(...))` hands back one `Response` whose body can be read only once; each call needs a fresh `Response` (`mockImplementation`).
- 2026-11-11: Hand mutants (trailing-slash strip removed, default `''` changed, prefix removed): all killed.
- 2026-11-11: Not checked: a browser, a real request across origins (CORS), the deployed build.

## Lessons

<fill when done>
