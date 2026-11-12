# Prepare waits until the target slot's Pods are gone (F04b, #117) — lessons

## Log

- 2026-11-12: Chose polling the Pod list over foreground deletion: same permissions, it waits on what holds the quota, and it also catches Pods left by a cancelled trial.

## Lessons

<filled when done>
