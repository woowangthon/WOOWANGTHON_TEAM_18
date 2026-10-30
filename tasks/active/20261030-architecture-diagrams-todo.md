# Architecture diagrams

- **SRS**: none yet (SRS UC/FR are still empty; this task only draws the architecture)
- **Owner**: TaeTaeJin
- **Branch**: docs/arch

## Plan

The classroom-PC premise is gone (3 spare PCs, 24h, club-room wired LAN) and the stack has been chosen in discussion (React+TS / Nest / FastAPI / AWS / Supabase / Kafka on EC2). Split the diagram into one `.drawio.svg` per tab under `docs/architecture/` (each file is its own source) and redraw tabs ①–④ on the new premise. Tabs ⑤ ⑥ are redrawn on the same premise so all seven tabs agree. This PR is diagrams only: the structure doc, ADRs, SRS, `ai-scope.md` and `CLAUDE.md` updates go in a follow-up PR.

## Todo

- [x] Split `WIP-arch.drawio.svg` into one SVG per tab; rename and reorder tabs (① overview, ② user1, ③ user2, ④ user3, ⑤, ⑥)
- [x] Update tabs ①–④ (AWS build/ECR/Supabase/bot PR, Playground entry, 80% ceiling, temp subdomain)
- [x] Add tab ②-2 user1 monitoring (`user1-monitoring.drawio.svg`); rename ② to ②-1
- [x] Rework tab ②-1 (review packet, two fix loops, server/leader responsibility split, end point, input type check)
- [x] Add the student-service DB add-on to ②-1 (MySQL first, then PostgreSQL; dump backup, no live replica)
- [x] Feedback round: DB backup via leader -> server -> S3, visible fix-loop frame, GitHub box solid, one-color-one-meaning palette and unified legend
- [x] Rework ②-2 into monitoring + operations (manual control within the 80% ceiling, operator approval for image updates, stop/resume, rollback, env vars, DB, delete, confirmed cost estimate); leader-migration plan as a text box on ①
- [x] Rework tab ③ (project hub + infra view incl. cluster/network/storage/platform, bot PR + S3 backup timeline + ECR visibility, forced actions + account suspension, email alerts, user/Playground management draft)
- [x] Final pass: one name per thing across tabs ①–④, contradictions removed, crossing edges and overlapping text fixed
- [x] Redraw ⑤ ⑥ on the new premise (club-room router LAN, 24h, 80% ceiling, workers kept from egress by policy, DB + backup job, AWS ECR, temp subdomain), keeping the original layout

## Done when

- [x] each of the seven SVGs (①, ②-1, ②-2, ③, ④, ⑤, ⑥) embeds exactly one tab and keeps its tab name
- [x] all seven tabs use the same names for the same things and the same legend
- [x] no box overlaps another box or crosses a zone border (geometry check), and edge labels were checked on rendered PNGs
- [x] "40%", "실습실", "라이브 USB" (as a premise) appear in none of the seven SVGs
