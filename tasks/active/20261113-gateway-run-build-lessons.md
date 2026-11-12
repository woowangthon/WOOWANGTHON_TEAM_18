# Gateway: run_build — lessons

## Log

- 2026-11-13: The hash is recomputed only for services whose `build` changed; an unchanged service keeps the run's hash and image, so a plain trial makes no GitHub call.
- 2026-11-13: "A run_build with the same patch" for verified is checked per changed service by the build input hash: a trial image of this ticket for that hash. An image found only in `build_cache` lets run_deploy pass but not verified; run_build then answers reused at once (#149) and records it.
- 2026-11-13: The buildOverrides allow lists (compute SMALL · MEDIUM · LARGE, image `aws/codebuild/standard:7.0`) are picked from the design table, not checked against real CodeBuild.
- 2026-11-13: First test run failed on the gateway tool-list test, which still expected the list without run_build.

## Lessons

- When a check moves from "forbidden" to "allowed with a condition", grep the tests and docs for the old refusal: every one becomes a case of the new condition.
- Opening a tool also changes the tool-list test; grep for the tool names list.
