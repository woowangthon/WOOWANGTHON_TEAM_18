# Deploy condition at W4 start — lessons

## Log

- 2026-11-10: Probed GitHub before writing the hash code. `git/trees/{commitSha}` answers with the top-level `sha` equal to the requested commit SHA, not the root tree SHA, so a `context: "."` hash read from it would have changed on every commit and never reused a build. The root tree is read from `git/commits/{sha}` → `tree.sha`.
- 2026-11-10: `validateServiceConditions` is not called by `prepare`: the values are built right there, so the call could never fail (a dead guard). It is exported for the side that receives the filled condition (build results in F02/F06).
- 2026-11-10: Hand-made mutants: 16 run, 14 killed at first. Survivors: the `dockerfile === null` part of the default-Dockerfile check (equivalent on a validated spec, removed) and the 39-char owner limit of the image pattern (test added).

## Lessons

- The top-level `sha` of a GitHub tree response is whatever you asked for. Read a commit's root tree from the commit object. (Candidate for BE/CLAUDE.md Pitfalls next to the existing `git/trees` entry.)
