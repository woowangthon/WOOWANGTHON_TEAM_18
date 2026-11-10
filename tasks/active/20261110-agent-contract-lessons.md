# Agent contract — lessons

## Log

- 2026-11-10: The §8 `match` example (`path` + `equals` + `messageRegex`) cannot say which field the regex reads. Replaced it with a condition tree; updated the example in AIagent.md.
- 2026-11-10: The dump test caught `to_camel("k8s") == "k8S"`. Parsing accepted `k8s` by field name, so only output was wrong.
- 2026-11-10: `re.error` is not a `ValueError`, so pydantic let a bad regex in `cases.json` escape as a crash instead of a validation error; the validator re-raises it as `ValueError`.
- 2026-11-10: Hand mutants found dead code: pydantic folds `X | None` into one error per field, so the loc filter and the per-path dedupe in `invalid_fields` never ran; `except CancelledError: raise` before `except Exception` is a no-op since 3.8; four error-type mappings had no field that could produce them. All deleted.
- 2026-11-10: A hand mutant run reused stale `.pyc` files: a mutant the same size as the original, restored within the same second, kept its bytecode, so later tests ran the mutant (a config test then failed on clean code, and one survivor had been reported killed). Re-ran every F09 and F10 mutant with `PYTHONDONTWRITEBYTECODE=1`; the true survivor (`i <= len(v)` in `select`) got a boundary test.
- 2026-11-10: Open contract questions sent to the coordinating session (not changed here): where `read_memory` runs, the `previous.status` values, the `stage: build` ticket's `raw.k8s`.

## Lessons

- Assert dumped JSON keys, not only parsed values, for alias-generated models (added to [`AI/CLAUDE.md`](../../AI/CLAUDE.md)).
- Hand mutants in Python: run with `PYTHONDONTWRITEBYTECODE=1` and clear `__pycache__` first, or a restored file can still run the mutant (added to `AI/CLAUDE.md`).
- Background tasks in FastAPI tests need the `with TestClient(...)` block (added to `AI/CLAUDE.md`).
