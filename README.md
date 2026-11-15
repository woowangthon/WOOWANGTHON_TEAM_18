# WCP

> 학교 PC 3대로 만든 k3s 클러스터에 학생이 자기 GitHub 레포를 무료로 배포하고, 배포가 막히면 AI 동료가 원인을 찾아 고쳐 주는 배포 · 운영 플랫폼.

2026 AI 우왕톤 18팀 왕가네식구들 · 주제 "AI는 동료가 될 수 있을까?"

| | 링크 |
| --- | --- |
| 서비스 | [app.stairnoworks.com](https://app.stairnoworks.com) |
| 시연 영상 | TBD (YouTube) |
| 발표 자료 | TBD (PDF) |
| Notion | [팀 대표 페이지](https://wangganae.notion.site/) |

## 목차

- [Summary](#summary)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Documentation](#documentation)

# Summary

- **누가**: 클라우드 비용 없이 프로젝트를 배포하고 싶은 학생, 프로젝트 과목이 끝난 뒤에도 서비스를 계속 운영하고 싶은 학생.
- **어떤 문제**: 상용 클라우드는 비용과 무료 한도가 부담되고(설문 37명 중 29명이 비용을 걱정), 프로젝트 과목은 배포에서 끝나 운영이 이어지지 않는다. 한편 학교 PC는 수업 시간 밖에는 놀고 있다.
- **어떻게**: 학교에서 빌린 PC 3대(리더 1 + 워커 2)를 k3s 클러스터로 묶고, 공개 GitHub 레포 주소만 넣으면 빌드 · 배포 · 동작 확인 · 공개 주소 연결(`<slug>.stairnoworks.com`)까지 플랫폼이 정해진 단계로 진행한다.
- **AI 동료가 하는 일**: 배포가 실패하면 AI 에이전트가 문제 티켓을 받아 원인을 찾고, 플랫폼이 허락한 도구로만 공개되지 않은 슬롯에서 고쳐 다시 확인한다. 레포 파일을 고쳐야 하면 봇 계정으로 수정 PR을 낸다. 운영 중 경고가 울리면 원인과 다음 행동을 제안한다.
- **사람이 결정하는 일**: 수정 PR 머지는 학생이, 경고 뒤 중지 · 무시는 운영자와 학생이 정한다. AI는 공개 주소를 바꾸지 않고, 비밀값을 읽지 않는다.

AI가 쓰이는 곳, 모킹 · 샘플, 검증하지 못한 것은 [`docs/ai-scope.md`](docs/ai-scope.md)에 모두 적었다.

## Features

| 기능 | 내용 |
| --- | --- |
| 배포 | 이메일 로그인 + GitHub 연동, 레포 소유 확인과 commit 확정, 설정 파일로 배포 설정 초안 채우기(규칙 코드), 비밀값 입력, 빌드 → 배포 → 동작 확인 → 공개 주소 연결, 진행 상태 · 결과 주소 |
| 무중단 전환 | 서비스마다 슬롯 A · B를 두고 live가 아닌 슬롯에 배포해 확인한 뒤 공개 연결만 바꾼다. 실패해도 지금 서비스는 그대로다 ([ADR-011](docs/adr/011-deploy-slots-a-b.md)) |
| 보안 검사 | 확정한 commit을 gitleaks · Trivy로 검사해 경고한다. 배포를 막지 않는다 |
| AI 문제 해결 | 실패를 문제 티켓으로 넘기면 추론 모델이 분류 · 계획하고 로컬 모델이 실행한다. 시험 전용 파이프라인에서 고쳐 본 뒤 배포를 처음부터 다시 실행한다 ([ADR-014](docs/adr/014-agent-trial-pipeline-and-rerun.md) · [ADR-017](docs/adr/017-planner-plans-local-executes.md)) |
| 운영 알림 | 재시작 반복은 규칙 코드가 바로 멈추고, 그 밖의 경고는 AI가 위험 · 권고 · 원인을 붙여 화면과 Discord로 알린다 (판단 정확도는 미검증) |
| 모니터링 · 제어 | 학생: 서비스 상태 · 지표 그래프 · 재시작 · 중지/재개 · 삭제. 운영자: 노드 자원 · 실행 중인 서비스 · 강제 중지 |

## Architecture

<p align="center"><img src="docs/architecture/overview.drawio.svg" alt="시스템 아키텍처 개요" width="960"></p>

| 다이어그램 | 무엇을 보여 주나 |
| --- | --- |
| [개요](docs/architecture/overview.drawio.svg) | 구성요소 전체와 연결 |
| [배포 워크플로우](docs/architecture/deploy-workflow.drawio.svg) | W0~W7 단계, 파이프라인 스테이지, 슬롯 A · B, 실패 처리 |
| [AI 에이전트 흐름](docs/architecture/agent-flow.drawio.svg) | 문제 티켓 → 분류 · 계획 · 실행 → 해결 결과 |
| [학생 배포 흐름](docs/architecture/user1-deployer.drawio.svg) | 학생이 보는 배포 과정 |
| [학생 모니터링 흐름](docs/architecture/user1-monitoring.drawio.svg) | 경고 · AI 판단 · 학생 제어 |
| [운영자 흐름](docs/architecture/user2-operator.drawio.svg) | 운영자 화면과 강제 중지 |
| [방문자 흐름](docs/architecture/user3-visitor.drawio.svg) | 공개 주소로 들어오는 길 |
| [클러스터](docs/architecture/cluster.drawio.svg) | 학교 PC 3대의 물리 · 클러스터 구성과 바깥 연결 |

다이어그램은 draw.io에서 바로 열어 고칠 수 있다(SVG 안에 원본 모델이 들어 있다).

## Tech Stack

| 영역 | 기술 | 결정 |
| --- | --- | --- |
| Frontend | React + TypeScript (Vite), S3 + CloudFront | [ADR-001](docs/adr/001-stack-and-deployment.md) |
| Backend (플랫폼 서버) | Nest.js on EC2 — 배포 단계 진행, 보안 검사, AI 도구 게이트웨이(MCP) | [ADR-001](docs/adr/001-stack-and-deployment.md) · [ADR-010](docs/adr/010-repo-analysis-and-security-scan-in-platform-server.md) · [ADR-012](docs/adr/012-agent-acts-through-platform-gateway.md) |
| AI 서버 | FastAPI + PydanticAI on EC2 | [ADR-001](docs/adr/001-stack-and-deployment.md) |
| AI 모델 | 추론 모델 `gpt-6.1-sol`(충북대 NOVA API Gateway, 분류 · 계획), 로컬 Qwen3-8B(리더 vLLM, 실행) | [ADR-016](docs/adr/016-planner-model-nova-gateway.md) · [ADR-017](docs/adr/017-planner-plans-local-executes.md) |
| Database · Auth | Supabase (PostgreSQL · Auth) | [ADR-007](docs/adr/007-login-email-password-github-link.md) |
| 빌드 · 레지스트리 | AWS CodeBuild, GHCR(공개 이미지) | [ADR-001](docs/adr/001-stack-and-deployment.md) · [ADR-003](docs/adr/003-registry-ghcr.md) |
| 배포 파이프라인 | GoCD (서버는 EC2, 실행기는 리더), 슬롯 A · B | [ADR-009](docs/adr/009-deploy-runs-on-leader-gocd-agent.md) · [ADR-011](docs/adr/011-deploy-slots-a-b.md) · [ADR-014](docs/adr/014-agent-trial-pipeline-and-rerun.md) |
| 클러스터 | k3s, 학교 PC 3대(리더 1 + 워커 2), 유선 스위치 | [ADR-005](docs/adr/005-k3s-cluster-on-school-pcs.md) · [ADR-008](docs/adr/008-node-network-on-school-wired-lan.md) |
| 네트워크 | Tailscale(서버 ↔ 클러스터 사설망), Cloudflare Tunnel(방문자 진입, `stairnoworks.com`) | [ADR-004](docs/adr/004-server-cluster-link-tailscale.md) · [ADR-013](docs/adr/013-visitor-entry-cloudflare-tunnel.md) |
| 모니터링 · 알림 | Prometheus · Grafana(리더), Discord 웹후크 | [ADR-006](docs/adr/006-metrics-on-leader-prometheus.md) |
| 학생 데이터 | 학생이 가져온 자기 DB (플랫폼은 DB · 볼륨을 띄우지 않는다) | [ADR-015](docs/adr/015-student-data-in-student-db.md) |
| 수정 PR | 봇 GitHub 계정의 fork → PR | [ADR-002](docs/adr/002-bot-account-for-fix-prs.md) |

## Documentation

| 문서 | 내용 |
| --- | --- |
| [`docs/SRS.md`](docs/SRS.md) | 요구사항 명세: 문제, 유즈케이스, 기능 · 비기능 요구사항, 데모 시나리오 |
| [`docs/system-definition.md`](docs/system-definition.md) | 시스템 정의서: 구성요소, 사용자별 흐름, 인프라 |
| [`docs/design/`](docs/design/README.md) | 모듈 설계와 FE · BE · AI API 계약 |
| [`docs/adr/`](docs/adr/README.md) | 기술 결정 기록 (ADR-001 ~) |
| [`docs/ai-scope.md`](docs/ai-scope.md) | AI · 외부 기술 · 모킹 · 미검증 범위 |
| [`docs/hackathon.md`](docs/hackathon.md) | 대회 규칙 · 일정 · 배점 |
| [`docs/pitch.md`](docs/pitch.md) | 발표 · 시연 영상 구성 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 작업 방식 · git · PR 규칙 |
| [Notion](https://wangganae.notion.site/) | 회의록 · 칸반 · 개발 일지 |
