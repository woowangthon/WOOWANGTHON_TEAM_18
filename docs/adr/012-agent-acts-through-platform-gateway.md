# ADR-012: AI 에이전트는 플랫폼 서버의 MCP 게이트웨이를 거쳐서만 행동하고, 대상 슬롯에서 직접 시험한다

- **상태**: 유효 (일부 대체: 시험 실행 방식 · verified 뒤 처리 → 014)
- **날짜**: 26-11-10
- **결정자**: 김현식
- **관련**: [AI 에이전트 설계](../design/AIagent.md), [배포 워크플로우 설계](../design/deploy-workflow.md) §6, [ADR-009](009-deploy-runs-on-leader-gocd-agent.md), [ADR-011](011-deploy-slots-a-b.md), [ADR-002](002-bot-account-for-fix-prs.md), [클러스터 설계](../design/cluster.md) §8

## 맥락

배포가 실패하면 AI 서버(FastAPI)의 에이전트가 원인을 찾아 고친다. spec 수정안만 돌려주고 플랫폼이 파이프라인을 다시 돌리면, 수정이 맞는지 재배포 뒤에야 알고 다시 실패하면 에이전트를 처음부터 다시 불러야 한다. 에이전트가 직접 배포를 시험하려면 빌드 · 클러스터 · GitHub에 손이 닿아야 하는데, 배포 쓰기 권한은 리더 실행기에만 있고(ADR-009) 사설망 규칙은 플랫폼 서버 → 리더 API 길만 연다(cluster.md §8).

## 결정

- AI 서버는 클러스터 · GoCD · 봇 계정 자격 증명을 갖지 않는다. 에이전트의 모든 도구는 플랫폼 서버(Nest)의 MCP 게이트웨이가 실행한다. 게이트웨이는 GoCD 파이프라인을 옵션(대상 슬롯, 시작 스테이지, Render까지만, 소스 커밋, Switch 건너뜀)으로 실행하고, k3s 읽기와 봇 계정 GitHub 호출을 대신한다.
- 에이전트는 대상 슬롯에서 Build · Render · Deploy · Verify를 직접 실행하고, 결과를 보며 고치고 다시 실행하는 루프를 스스로 돈다. 행동 범위는 사용자 코드를 직접 바꾸는 것을 뺀 배포 설정 전부다: spec(`slug` · `name`은 첫 배포 전에만), 그 빌드에만 쓰는 CodeBuild 설정(컴퓨팅 크기 · 제한 시간 · 빌드 이미지 · 캐시, 상한 안), 대상 슬롯 운영(재시작 · 개수 조정). 코드 수정은 봇 계정 수정 PR로 제안한다(ADR-002). manifest는 플랫폼 코드가 spec으로 만든다.
- 전환(open Ingress), live 슬롯, Secret 값, 플랫폼이 같이 쓰는 설정(CodeBuild 프로젝트 · buildspec · IAM, ResourceQuota · LimitRange · NetworkPolicy, 차트, 기본 Dockerfile)은 도구로 주지 않는다. 게이트웨이가 횟수 제한 · live 슬롯 보호 · 수정안 경로 · override 상한을 검사한다.
- 에이전트가 `verified`를 돌려주면 플랫폼이 수정안을 검증 · 저장하고, 대상 슬롯을 다시 확인한 뒤 Switch와 W7을 실행한다.

## 대안

| 대안 | 장점 | 버린 이유 |
| --- | --- | --- |
| 에이전트는 spec 수정안만 돌려주고 플랫폼이 파이프라인을 다시 실행 | 에이전트 쪽 도구가 적다 | 수정이 맞는지 재배포 뒤에야 알고, 다시 실패하면 에이전트를 처음부터 다시 부른다 |
| AI 서버에 클러스터 · GoCD 권한을 직접 준다 | 게이트웨이가 필요 없다 | 배포 쓰기 권한이 리더 밖으로 나가고(ADR-009), 사설망 규칙을 넓혀야 한다. LLM이 고른 호출을 막을 곳이 없다 |

## 결과

- 쉬워지는 것: 에이전트가 고친 것을 같은 실행 안에서 확인하고 다시 시도한다. 성공하면 이미 대상 슬롯에 떠 있어 전환만 하면 된다. 권한과 사설망 규칙은 그대로다.
- 어려워지는 것: 플랫폼 서버에 MCP 게이트웨이(도구 실행, 횟수 제한, 검사)를 만들어야 한다. 에이전트가 반복하므로 횟수 제한을 처음부터 넣어야 한다.
- 다시 볼 조건: 에이전트 반복이 파이프라인 대기 때문에 너무 느릴 때, 게이트웨이 검사로 막지 못하는 잘못된 수정이 나올 때.

## 정정 (2026-11-15)

코드·설정과 대조해 사실이 달라진 곳만 적는다. 결정 자체는 바꾸지 않는다. 시험 실행 방식과 `verified` 뒤 처리는 상태 줄대로 [ADR-014](014-agent-trial-pipeline-and-rerun.md)가 바꿨다.

- 결정의 "spec(`slug` · `name`은 첫 배포 전에만)"은 지금 허용하지 않는다. `slug` · `name`은 슬롯과 Secret 이름이 따라가므로 대상 슬롯에서 시험할 수 없어 게이트웨이가 늘 `PATCH_FORBIDDEN`으로 막는다(`BE/src/gateway/spec-patch.ts`).
- 결정의 "대상 슬롯 운영(재시작 · 개수 조정)"은 게이트웨이 도구로 열지 않았다. 게이트웨이가 여는 도구는 열 개다: `get_target_status` · `read_pod_logs` · `read_repo` · `run_build` · `run_render` · `run_deploy` · `run_verify` · `edit_repo_file` · `open_pr` · `submit_result`(`BE/src/gateway/tools.ts`).
- 결정의 CodeBuild 설정 범위(컴퓨팅 크기 · 제한 시간 · 빌드 이미지 · 캐시)는 코드에서 더 좁다. 컴퓨팅 크기는 `BUILD_GENERAL1_SMALL`만, 빌드 이미지는 프로젝트와 같은 것만, 제한 시간은 20분까지 받는다(`OVERRIDE_*`, [AI 에이전트 설계](../design/AIagent.md) §3).
