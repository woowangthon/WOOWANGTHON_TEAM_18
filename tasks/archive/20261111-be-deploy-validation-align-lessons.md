# BE deploy input validation align — lessons

## Log

- 2026-11-11: Values taken from PR #77 head `cb17c5a`, then re-checked after rebase against the merged `deploy-handoff.md` (#77) and `cluster.md` §9 (#91). The merged handoff says prefix-overlapping paths (`/api`, `/api/v1`) are allowed, which is what the validator does (only the same string is rejected). The reserved slug list is now `cluster.md` §9 (23 names), so the validator follows it instead of the temporary list. The two merged docs disagreed on the slug limit (`deploy-handoff.md` 1~40, `cluster.md` and `api.md` 1~58, a value written in #79): the validator and `api.md` follow the issue and handoff (40), and the one `cluster.md` sentence that copied 58 now says 40.
- 2026-11-11: Making `role` and `ingressPath` unique broke fixtures that clone a service (the 3-service and 4-service tests): the clone repeated the `ingressPath`. A fourth service always repeats a role (there are three), so that test now expects `services` OUT_OF_RANGE plus `DUPLICATE` at `services[3].role`.

## Lessons

- A limit written as a regex quantifier (`{0,38}`) hides the off-by-two between the limit and the number; the boundary rows in the tests (40 ok / 41 rejected, 30 / 31, 5 / 300) are what keep it honest.
- Two merged docs can state the same limit differently (`deploy-handoff.md` 40, `cluster.md` 58 copied from an earlier `api.md`). Check the merged docs again after a rebase, and make the doc that only repeats a number point to the one that owns it.
- A hand-copied list (reserved slugs) is kept in sync by a comment only; if it drifts again, make the spec read the doc.
