# ADR-001: 플랫폼은 React+TS / Nest / FastAPI를 AWS에서 운영하고, DB·인증은 Supabase, 큐는 EC2 위 Kafka로 둔다

- **상태**: 유효 (일부 대체: 레지스트리 → [003](003-registry-ghcr.md), 인증 → [007](007-login-email-password-github-link.md), 배포 전 검토의 레포 분석 · 보안 검사 → [010](010-repo-analysis-and-security-scan-in-platform-server.md))
- **날짜**: 26-10-29
- **결정자**: 태진, 유성, 현식
- **관련**: [시스템 정의서](../system-definition.md)

## 맥락

학생 서비스를 돌릴 PC가 강의실 PC에서 **남는 PC 3대(24시간 가동)** 로 바뀌었다. 학생 코드를 빌드하는 단계는 학생 코드를 실행하므로 교내 PC가 아니라 밖에서 해야 하고, 플랫폼 서버(요청 접수·AI 검토·빌드 요청·배포 지시)도 밖에 둔다. 로그인은 GitHub OAuth를 쓸 예정이다. 해커톤 제약: 비용(MSK는 상시 과금이 크다), 팀의 익숙함, 마감(2026-11-15).

## 결정

- FE는 React + TypeScript, BE는 Nest.js, AI 서버는 별도 FastAPI(배포 전 검토, 스파이크 원인 설명 · 제안)로 한다.
- 플랫폼 운영과 빌드(CodeBuild)·레지스트리(ECR)·스토리지(S3)는 AWS에서 한다.
- DB와 인증(GitHub OAuth)은 Supabase를 쓴다.
- 메시지 큐는 Apache Kafka를 EC2 **단일 브로커**로 둔다 (MSK 아님).
- 실행 단위: FE는 S3 + CloudFront(정적), BE · AI 서버 · Kafka는 EC2 인스턴스로 둔다.
- 플랫폼을 우리 클러스터로 옮기는 것은 목표로만 두고 지금은 AWS에서 운영한다.

## 대안

| 대안 | 장점 | 버린 이유 |
| --- | --- | --- |
| 인증도 직접 구현 (Nest + Passport) | 외부 의존이 줄어든다 | GitHub OAuth를 직접 붙이는 비용이 크다. Supabase가 더 편하다 |
| MSK | 운영 부담이 없다 | 상시 과금이 크다 |
| BE와 AI를 한 서비스로 | 구성이 단순하다 | AI 검토는 Python 쪽 생태계(LangChain)가 맞고, 학생 코드를 읽는 부분을 BE와 분리하고 싶다 |
| 플랫폼 서버도 처음부터 우리 클러스터 | AWS 비용이 줄어든다 | 리더 노드가 단일 장애점이고 동아리방 네트워크가 아직 검증되지 않았다. 심사 기간에 URL이 죽는 위험이 크다 |

## 결과

- 쉬워지는 것: GitHub 로그인, 빌드 격리(CodeBuild), 이미지 보관(ECR).
- 어려워지는 것: Kafka 단일 브로커는 장애 시 이벤트가 멈춘다. AWS 비용을 직접 관리해야 한다.
- 다시 볼 조건: 클러스터로 플랫폼을 옮길 때, 도메인을 확보할 때, Kafka를 계속 쓸지 판단할 때.
- 이 ADR로 정하지 않은 것: LLM 업체·모델, 터널 제공자, 테스트·뮤테이션 도구, CI. 스택 ADR이 채워야 하는 [`CLAUDE.md`](../../CLAUDE.md) Commands와 [`conventions.md`](../conventions.md) §6도 별도 작업으로 남아 있다.

## 정정 (2026-11-15)

코드·설정과 대조해 사실이 달라진 곳만 적는다. 결정 자체는 바꾸지 않는다.

- Kafka: 2026-11-09 회의에서 후순위로 미뤘고 코드 · 인프라에 없다([시스템 정의서 Kafka 범위](../system-definition.md#kafka-범위)). 위 결정의 Kafka 항목(단일 브로커, EC2 배치)은 지금 적용되지 않는다.
- 스토리지(S3): 플랫폼 FE의 정적 파일(S3 + CloudFront)에만 쓴다. 학생 정적 웹은 클러스터의 Pod가 서빙한다([시스템 정의서](../system-definition.md)의 서비스 유형 표).
- AI 서버: 대안 표의 LangChain은 쓰지 않는다. PydanticAI를 쓴다([`ai-scope.md`](../ai-scope.md)).
- "정하지 않은 것" 중 LLM 업체·모델은 [ADR-016](016-planner-model-nova-gateway.md), 터널 제공자는 [ADR-013](013-visitor-entry-cloudflare-tunnel.md)에서 정했다. [`CLAUDE.md`](../../CLAUDE.md) Commands와 [`conventions.md`](../conventions.md) §6의 테스트 도구, CI는 채워졌다. 뮤테이션 테스트 도구만 아직 정하지 않았다.
