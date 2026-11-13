# Apply: an unschedulable Pod at the limit is a platform problem (F04c) — lessons

## Log

- 2026-11-13: Decided on the Pod condition (`PodScheduled=False/Unschedulable` on a Pending Pod) rather than the FailedScheduling event, since events expire; judged only at the limit because node room can free up.

## Lessons

<filled when done>
