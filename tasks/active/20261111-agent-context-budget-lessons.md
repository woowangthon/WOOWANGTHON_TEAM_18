# Agent context budget — lessons

## Log

- 2026-11-11: First measurement with the biggest test ticket gave 46–48K chars per local request; the event list in tool results (50 events × 400 chars) dominated. Tool-result events now follow the digest rule; the largest request is about 24K chars against the 30K estimate.
- 2026-11-11: The first run of this work in the test session (4ca6007) failed on test data, not code: the sample error lines sat in the part the 24KB cut drops, the big test pod was OOMKilled so A3 matched before A1, and a history test compared two separately built message lists (timestamps differ). Fixed the tests.
- 2026-11-11: Carried over from 4ca6007 by cherry-pick; `loop.py`, `AIagent.md` and `ai-scope.md` conflicted with #110 and were re-applied by hand on the merged versions.
- 2026-11-11: ruff counts East Asian characters as width 2 for E501; a character count misses long Korean lines.

## Lessons

- Measure the prompt size with the biggest realistic input before choosing limits; the first guess missed the largest contributor.
- Put test data where the code under test keeps it: a cut that drops the start of a log also drops the sample error lines placed there.
