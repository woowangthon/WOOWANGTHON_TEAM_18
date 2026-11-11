# Pipeline glue: fetch-input and notify CLIs — lessons

## Log

- 2026-11-11: started from the coordinating session's request (PR-A of #135). Read api.md and `validateNotice`: BE needs `raw.k8s.status` to be an object on `render` and `null` elsewhere, `raw.codebuild` an object on `build`, and times with a zone in `logs`. `null` in `failure.code` means "student problem, call the AI agent", so the mapper must never turn a bad platform code into `null`.

## Lessons

<filled when done>
