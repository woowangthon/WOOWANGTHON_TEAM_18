# 운영 알림(스파이크 감지 → AI 판단 → 알림) — 설계

- **상태**: 구현됨 (2026-11-14, 운영 확인 전)
- **관련**: SRS UC-15, FR-078 · FR-079 · [ADR-006](../adr/006-metrics-on-leader-prometheus.md) · API 계약은 [`api.md`](api.md) "운영 알림"

## 범위

- 학생 서비스가 클러스터에서 문제를 일으키면 알아채고, 위험한 것은 멈추고, 이유를 사람에게 알린다.
- **감지는 새로 만들지 않는다.** 리더의 Prometheus(kube-prometheus-stack)가 기본 규칙 125개를 이미 평가한다. Alertmanager는 꺼져 있어 경고가 어디에도 가지 않았다. 플랫폼 서버가 그 경고를 읽는다. 클러스터는 바꾸지 않는다.
- **AI는 판단만 한다.** 규칙 코드가 바로 멈추는 것은 재시작 반복 하나다. 나머지는 AI가 원인 · 위험 · 권고를 내고 운영자가 중지나 무시를 정한다(FR-079).
- 하지 않는 것: 다시 켜기(학생이 다시 배포하면 뜬다), 메모리 한도 초과의 별도 처리(쿠버네티스가 컨테이너를 다시 시작하고, 반복되면 재시작 반복으로 잡힌다), 알림의 반복 발송, AI의 자기 개선.

## 설계

### 흐름

```
Prometheus /api/v1/alerts ──(20초마다, 리더 API 서비스 프록시 GET)──▶ 플랫폼 서버 AlertWatcher
  ├─ namespace proj-<slug> 경고 → incidents 한 줄 (같은 slug · 경고는 하나로 묶음)
  │    ├─ KubePodCrashLooping, 진행 중 배포 없음 → Deployment 모두 0 → auto_stopped → Discord(운영자 · 학생)
  │    └─ 그 밖 → AI 서버 POST /agent/incidents (로컬 Qwen3 → 실패하면 추론 API) → ai 저장 → Discord(운영자 · 학생)
  │         └─ 운영자 화면 "운영 알림"에서 중지 / 무시 (action stopped / dismissed)
  ├─ Node* 경고(namespace 없음) → 운영자 Discord로만, 울리는 동안 한 번
  └─ 사라진 경고 → resolved_at
```

- 코드: `BE/src/incidents/`(감시기 `alert-watcher.ts`, 판단 요청 `incident-judge.ts`, Discord `discord.notifier.ts`, API `incidents.controller.ts`), `AI/ai_server/agent/incident.py`, 테이블 `supabase/migrations/20261114070000_create_incidents.sql`.
- 경고 이름 → 화면 문구는 `BE/src/incidents/incident-text.ts`. 모르는 경고는 `클러스터 경고: <이름>`이다.

### 규칙

| 경우 | 동작 | 까닭 |
| --- | --- | --- |
| `KubePodCrashLooping`, 그 프로젝트에 진행 중 배포(queued · running · fixing) 없음 | 바로 멈춤(`auto_stopped`), AI를 부르지 않음 | 15분 넘게 계속 죽는 서비스는 고쳐서 다시 배포하는 것 말고 할 일이 없다 |
| `KubePodCrashLooping`, 진행 중 배포 있음 | 멈추지 않고 AI 판단(`pending`) | 배포 중의 실패는 파이프라인 확인과 AI 에이전트가 다룬다 |
| 그 밖의 학생 프로젝트 경고 | AI 판단 → 운영자가 정함 | AI가 직접 조치하지 않는다(FR-079) |
| `Node*` | 운영자 Discord만 | 학생과 상관없는 플랫폼 문제다 |
| `Watchdog` · `InfoInhibitor` · `Prometheus*`, state `pending`, 그 밖의 namespace | 무시 | 늘 울리거나 감시 도구 자신의 경고다 |

- 경고를 읽지 못하면(리더가 잠깐 안 보임) 열린 알림을 닫지 않고 다음 확인을 기다린다.
- 멈추면(운영자 중지 · 자동 중지) 그 프로젝트의 정할 차례인 알림을 모두 같은 결정으로 닫는다. 한 프로젝트에 경고가 둘 떠도 중지는 한 번이다. 무시는 알림 하나만 닫는다(다른 경고는 다른 원인일 수 있다). 운영자 중지가 하나도 내리지 못하면(503) 아무것도 닫지 않는다.
- AI 판단이 끝나기 전에 운영자가 정했거나 중지로 함께 닫힌 알림은, 판단 결과를 화면에는 남기되 Discord로는 보내지 않는다.
- 멈추기는 운영자 강제 중지와 같다: 공간의 Deployment를 모두 `replicas: 0`. 서버 계정의 scale 권한과 검사 규칙(0 · 1만)을 그대로 쓴다.
- AI 판단(최대 90초)은 20초 확인을 막지 않게 따로 돈다. 못 받으면 `ai.status = failed`이고 알림은 그대로 간다.
- 저장한 뒤 처리(자동 중지 · AI 판단 · 알림)가 실패하거나 서버가 다시 떴으면, 경고가 아직 울리고 AI 판단이 비어 있는 알림을 다음 확인이 다시 처리한다.
- 자동 중지는 Deployment를 **모두** 내렸을 때만 `auto_stopped`다. 일부만 내렸으면 `pending`으로 두고 다음 확인이 나머지를 다시 내린다. 하나도 못 내렸으면 AI 판단으로 넘긴다.
- 노드 경고는 DB를 쓰지 않아 DB가 안 보여도 간다.

### AI에 보내는 것

경고 이름 · summary · 고른 라벨(namespace · pod · container · deployment 등), Pod 목록(이름 · phase · ready · 재시작 수 · 기다리는 이유), 경고의 Pod(없으면 가장 많이 재시작한 Pod) 로그 200줄(재시작했으면 직전 컨테이너, 3초 상한). 로그는 BE의 비밀값 필터를 거치고, 추론 API로 갈 때는 AI 서버의 가림 필터를 한 번 더 거친다. AI는 로그 발췌(오류 줄 앞뒤 + 마지막 20줄)만 본다.

### 알림

- 운영자: SSM `/wcp/be/DISCORD_WEBHOOK_URL`(env `DISCORD_WEBHOOK_URL`, 선택).
- 학생: `/profile`에서 넣은 자기 웹후크(`user_webhooks`, 서버만 읽는다. 응답에는 끝 4자만). 넣지 않았으면 앱 안 표시만.
- 배포 결과(학생만): 실행 기록이 끝나면(성공 · 실패 · 학생 확인 필요) 학생 웹후크로 한 줄 보낸다. 실패는 단계 · 코드 · 안내 문장과 AI 요약, AI가 PR을 열었으면 PR 주소와 "머지한 뒤 다시 배포해 주세요", 학생 조치가 필요하면 그 요청이다. 끝내는 곳이 여러 군데라 `DeploysStore.updateRun`이 실제로 끝 상태로 바꿨을 때 `DeployEvents`를 내고 `deploy-result.notifier.ts`가 보낸다. 운영자 채널에는 보내지 않는다(배포가 많다).
- 주소는 `https://discord.com/api/webhooks/<id>/<token>` 모양만 받는다(서버가 다른 곳으로 요청하지 않게). `@everyone` 같은 호출은 막는다(`allowed_mentions`). 보내기 실패는 로그만 남기고 감시는 계속한다.

## 알려진 한계

- 노드 경고의 "한 번"은 서버 메모리라 서버가 다시 뜨면 한 번 더 간다.
- 결과(자동 중지 · AI 판단)를 저장한 직후, Discord로 보내기 전에 서버가 다시 뜨면 그 알림의 Discord 글은 가지 않는다. 앱 안 표시(운영자 화면 · 학생 배너)는 저장된 값을 보이므로 빠지지 않는다. Discord는 보조 알림이라 보낼 차례를 따로 저장하지 않는다.
- PostgREST 한 번에 1,000행까지 읽는다(Supabase 기본). 학생 한 명의 배포 기록이 1,000건을 넘거나, 해소되지 않은 알림이 1,000건을 넘으면 일부가 빠질 수 있다. MVP 규모(프로젝트 수십 개)에서는 닿지 않는다. 운영자 API의 다른 목록(`admin.store.ts` 500행)과 같은 수준의 한계다.
- 배포 결과 Discord는 끝 상태로 바꾼 서버 메모리에서 바로 보낸다. 바꾼 직후 서버가 다시 뜨면 그 배포의 글은 가지 않는다("내 배포" 화면은 저장된 값을 보인다).
- 경고는 규칙의 `for` 시간(재시작 반복은 15분)이 지나야 firing이다. 그 전에는 알림이 없다.
- AI 판단의 정확도는 확인하지 않았다(`ai-scope.md` FR-079).
