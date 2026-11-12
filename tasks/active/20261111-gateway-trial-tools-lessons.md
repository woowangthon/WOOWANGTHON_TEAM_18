# Gateway: trial tools — lessons

## Log

- 2026-11-11: `name` · `slug` patches are refused in B1 too. The trial reuses the run's deploy_condition (keyed by service name), and the slot resources and the `<service>-secrets` Secret follow the service name, so a renamed service cannot be tried on the target slot. The verified result may still carry them later (B2 decides).
- 2026-11-11: The ticket start is not stored. The budget takes it once, from the first token expiry (issue + 15 min), before any trial wait moves the expiry.
- 2026-11-11: GoCD cancels per stage. The client reads the instance and cancels every `Building` stage; the paths, headers and the `counter` type are from the GoCD docs only, not a real server.
- 2026-11-11: First test-session run failed on three of my mistakes: a doc comment I split left `listOwned` inside a comment, GatewayModule lacked ConfigModule for the guard (every e2e died), and a budget test used the real clock with ticket start 0. Then one e2e waited 30 minutes because the fake pipeline answered stage `apply` to `run_render`.
- 2026-11-12: CodeRabbit review of #150, twelve findings, all taken (user decision). Changed in form: the review's restart rule (ticket start = stored expiry - 60 min whenever the budget has no record) would also hit every fresh ticket on its first call and forbid any trial wait, so the conservative start applies only to tickets last touched before this process started; and the expiry written at a wait's start or end never goes below the expiry first seen, or a restarted ticket's token would close at once. Live path protection now compares the trial input with the live input even without a patch. The counter is required on the input read; a result is taken only while the run is `fixing` on that ticket. A waiting trial always ends by its own timer before the token, so no expiry path leaves it behind.

## Lessons

- A rule written for one case (restart) must be checked against the common case (first call) before taking it as is.
- A guard used by a controller resolves its dependencies in the controller's module: import ConfigModule there too.
- When inserting code above a doc comment, check the comment still closes.
- A wait that runs longer than the token lifetime needs the expiry moved when the wait starts, not when it ends; otherwise a parallel call on the same ticket sees `TICKET_CLOSED`.
