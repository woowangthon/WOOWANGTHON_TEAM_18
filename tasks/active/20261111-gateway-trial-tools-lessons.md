# Gateway: trial tools — lessons

## Log

- 2026-11-11: `name` · `slug` patches are refused in B1 too. The trial reuses the run's deploy_condition (keyed by service name), and the slot resources and the `<service>-secrets` Secret follow the service name, so a renamed service cannot be tried on the target slot. The verified result may still carry them later (B2 decides).
- 2026-11-11: The ticket start is not stored. The budget takes it once, from the first token expiry (issue + 15 min), before any trial wait moves the expiry.
- 2026-11-11: GoCD cancels per stage. The client reads the instance and cancels every `Building` stage; the paths, headers and the `counter` type are from the GoCD docs only, not a real server.

## Lessons

- A wait that runs longer than the token lifetime needs the expiry moved when the wait starts, not when it ends; otherwise a parallel call on the same ticket sees `TICKET_CLOSED`.
