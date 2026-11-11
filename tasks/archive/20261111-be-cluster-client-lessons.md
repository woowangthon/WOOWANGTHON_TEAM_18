# BE: cluster client module — lessons

## Log

- 2026-11-11: Issue #111 opened; branch cut from PR #106's head `20cefc7` (#106 still a draft, approved). Design doc written before code.
- 2026-11-11: A `status` field on `ClusterError` shadowed `HttpException`'s own `status` and broke #106's tests (`status: 503` became `undefined`). Renamed to `apiStatus` / `apiReason`.
- 2026-11-11: The fake k8s API moved to `BE/test/fake-k8s.ts` so three spec files share it. It now answers per `<method> <path>`, accepts an empty body (GET) and closes idle connections on `close()` — with a keep-alive client `server.close()` otherwise waits for the idle socket.
- 2026-11-11: Real leader check from the operator Mac in `proj-clicheck-1111` (result table in the design doc): POST 201, 409 → PUT 200, reads, refusals (403 for Secret get/list/patch/delete, 422 for a non-`proj-` write, another name, token type, bad key), namespace deleted and gone in 6 s. Refusal probes that would create something if they passed went as server dry runs.
- 2026-11-11: #106 squash-merged (with a sixth space object, the executor RoleBinding). Rebased the six #111 commits with `--onto upstream/main 20cefc7`; conflicts only in `docs/ai-scope.md` and `docs/design/space.md`, kept main's text and added the #111 sentence. Design doc now says six objects; the real-leader `ensureSpace` row was run before the sixth object existed. `pnpm verify` green after the rebase (896 tests).

## Lessons

- A field added to a class that extends Nest's `HttpException` must not be called `status`, `response` or `message`: it silently replaces the parent's and `getStatus()`-style assertions start failing far from the cause.
- A refusal probe against the real cluster goes as a server dry run (`?dryRun=All`) whenever passing would create something the account cannot delete (the server account can create Secrets but not delete them).
- With a keep-alive client, a test server's `close()` waits for idle sockets; call `closeAllConnections()` first.
