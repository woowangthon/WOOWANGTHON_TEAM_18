# Agent: W6 verify failures as tickets — lessons

## Log

- 2026-11-11: V1's signal is "an `asset` request that is 404": two fields of the same element. The existing `all` combinator matches across elements (a 404 page next to a 200 asset would match), so `match` got a `contains` test instead of an element-scoped `all`.
- 2026-11-11: The `verify` raw key is optional (default `null`) so tickets from #107, which do not send it, stay valid.
- 2026-11-11: The session's worker restarted mid-task; the working tree survived and work continued from it.

## Lessons

- When a signal needs several fields of one element, say so in the condition; independent conditions over `[*]` do not mean "the same element".
