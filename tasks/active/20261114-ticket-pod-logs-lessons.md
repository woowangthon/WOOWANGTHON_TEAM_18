# Problem ticket logs — lessons

## Log

- 2026-11-14: The ticket is sent inside the pipeline's notice request (10 s client limit), so the log read races a 3 s timer. The read gets its own `.catch` before the race: a read that fails after the timer already won would otherwise be an unhandled rejection.

## Lessons

- When racing a promise against a timer, handle the loser's rejection too.
