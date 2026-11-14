# 학생 공간 만들기 — 설계

- **상태**: 초안 (2026-11-11, 이슈 [#81](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/81) 1단계. 실제 리더 확인은 아래 알려진 한계)
- **관련**: [cluster.md](cluster.md) §6(양식) · §8(서버 권한) · §12(비밀값), [deploy-workflow.md](deploy-workflow.md) W3, [ADR-004](../adr/004-server-cluster-link-tailscale.md)

## 범위

플랫폼 서버(BE)가 Tailscale로 리더의 쿠버네티스 API에 붙어 프로젝트의 학생 공간 `proj-<slug>`를 만드는 부분이다.

- 하는 것: 리더 접속 설정(주소 · 토큰 · CA), 쿠버네티스 API 호출 도우미, 공간 객체 여섯 만들기, 오류를 `503`으로 돌려주기.
- 하지 않는 것: Secret 쓰기(W3, #43), 조치 · 조회(재시작 · Pod 상태 · 로그), 사용자가 부르는 HTTP 엔드포인트. Secret 쓰기 · 읽기 함수와 오류를 종류로 나누는 것은 [cluster-client.md](cluster-client.md)(#111)에 있다. 이 모듈은 서버 안에서 부르는 서비스이고 FE가 보는 API가 없다. 부르는 곳은 둘이다: 비밀값 쓰기(W3, `ClusterSecretWriter`가 Secret을 쓰기 전)와 배포 시작(`POST /api/deploys/:id/start`가 실행 기록을 저장하기 전, [api.md](api.md)). 비밀값이 없는 프로젝트는 비밀값 쓰기를 건너뛰므로 배포 시작이 공간을 만든다. 공간이 없으면 실행기 RoleBinding도 없어 Prepare가 `403`(`EXECUTOR_FORBIDDEN`)으로 끝난다(2026-11-14 실제 서비스에서 확인).
- 이 서버 계정이 할 수 있는 것은 [cluster.md §8](cluster.md#8-플랫폼-서버와-배포-실행기의-권한)이 정한다. 여기서는 그 권한 안에서만 부른다.

## 설계

### 접속 설정

`BE/.env` · 배포처의 환경 설정에 셋을 둔다. 값은 인프라 담당이 EC2 설정에 넣을 때 따로 전달한다(레포 · 채팅에 올리지 않는다, cluster.md §12).

| 변수 | 뜻 |
| --- | --- |
| `K8S_API_URL` | 리더 API의 origin. 예: `https://100.x.y.z:6443`. 경로 · 끝 `/`는 안 된다. `http`는 로컬 시험(loopback)만 허용한다 |
| `K8S_TOKEN` | 서버 계정(`platform` 공간의 `platform-server`)의 토큰. 공백이 없어야 한다. **비밀**: 로그 · 응답 · 오류 메시지에 싣지 않고 `K8S_API_URL`로만 보낸다 |
| `K8S_CA_CERT` | 리더 API 인증서를 서명한 CA. **PEM만** base64 한 줄로 적는다(`base64 -w0 ca.crt`. `openssl x509 -text` 출력처럼 PEM 앞에 설명 글이 붙은 파일은 서버가 PEM이 아니라고 보고 부팅을 멈춘다). 배포처(EC2의 Docker `--env-file`)가 변수당 한 줄만 받기 때문이다. 서버가 부팅 때 풀어 PEM이 아니면 멈춘다. 인증서의 주소(Tailscale 주소)는 이 CA로 검증한다 |

**없을 때의 동작**: 셋이 모두 비어 있으면 서버는 그대로 뜨고(`/api/health` 등 나머지는 정상), 클러스터를 쓰는 기능만 `503 CLUSTER_UNAVAILABLE`로 답한다. 인프라가 값을 주기 전에도 BE가 뜨게 하려는 것이다. **일부만 채우면** 부팅을 멈춘다(빠진 변수 이름만 메시지에 적고 값은 싣지 않는다): 하나를 빠뜨린 채 "설정 안 됨"으로 조용히 도는 것보다 낫다.

### 호출

- 연결은 `node:https`로 한다. 리더 API는 자체 CA로 서명되어 있고, 전역 `fetch`는 요청마다 CA를 줄 수 없다(그러려면 `undici`가 필요하다). 새 라이브러리를 넣지 않는다.
- 헤더: `Authorization: Bearer <토큰>`, 본문은 JSON. 제한 시간 5초. 응답 본문은 끝까지 읽는다.
- 인증서 검증은 끄지 않는다. 검증 실패 · 연결 거절 · 시간 초과는 모두 리더에 닿지 못한 것이다.

### 공간 만들기

`ensureSpace(slug)`가 [`Infra/student/space.yaml`](../../Infra/student/space.yaml)과 **같은 값**으로 여섯 객체를 이 순서로 만든다. 이름만 `proj-demo` → `proj-<slug>`로 바꾼다(검사 규칙이 양식과 같은 값만 통과시킨다, cluster.md §8). 양식을 고치면 코드도 같이 고친다.

| 순서 | 객체 | 요청 |
| --- | --- | --- |
| 1 | Namespace `proj-<slug>` (라벨은 보안 등급 둘뿐) | `POST /api/v1/namespaces` |
| 2 | LimitRange `container-defaults` | `POST /api/v1/namespaces/proj-<slug>/limitranges` |
| 3 | ResourceQuota `project-cap` | `POST /api/v1/namespaces/proj-<slug>/resourcequotas` |
| 4 | NetworkPolicy `project-isolation` | `POST /apis/networking.k8s.io/v1/namespaces/proj-<slug>/networkpolicies` |
| 5 | RoleBinding `platform-server-read` | `POST /apis/rbac.authorization.k8s.io/v1/namespaces/proj-<slug>/rolebindings` |
| 6 | RoleBinding `deploy-executor` (ClusterRole `proj-deployer` → `deploy` 공간의 ServiceAccount `deploy-executor`) | 같은 경로 |

- 위에서부터 하나씩 차례로 보내고, 하나가 실패하면 거기서 멈춘다. RoleBinding은 권한 연결이라 마지막이다. `deploy-executor`가 없는 공간에는 리더 배포 실행기가 배포하지 못한다(`403`, 실행기 계정에 클러스터 전체 권한이 없다).
- **`409`(본문 `reason: AlreadyExists`)는 성공으로 본다.** 서버는 고치기 · 읽기 권한이 없어 이미 있는 것을 확인할 수 없고, 같은 `slug`로 다시 부르거나(재시도, 같은 프로젝트의 다음 배포) 중간에 끊긴 뒤 이어 가도 같은 결과가 되게 하려는 것이다. 이미 있는 객체의 값이 양식과 같은지는 확인하지 않는다(알려진 한계).
- 인자는 검증을 통과한 `slug`만 받는다(`^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$`, [api.md](api.md)). 아니면 던진다: 요청 경로에 들어가는 값이다.

### 오류

| 응답 | 의미 | 서버가 돌려주는 것 |
| --- | --- | --- |
| `201` | 만들어짐 | 성공 |
| `409` + `AlreadyExists` | 이미 있음 | 성공 |
| 연결 실패 · 인증서 검증 실패 · 시간 초과 | 리더에 닿지 못함 | `503 CLUSTER_UNAVAILABLE` |
| `401` | 토큰이 틀림 · 폐기됨 | `503 CLUSTER_UNAVAILABLE` |
| `403` | 권한 없음 | `503 CLUSTER_UNAVAILABLE` |
| `422` | 검사 규칙이 거절(양식과 다른 값) | `503 CLUSTER_UNAVAILABLE` |
| 그 밖의 `4xx` · `5xx` · 읽을 수 없는 응답 | | `503 CLUSTER_UNAVAILABLE` |

`401` · `403` · `422`는 사용자 잘못이 아니라 서버 설정이나 코드의 문제라서 `4xx`로 넘기지 않고 `503`으로 구분한다. 어느 경우인지는 로그에만 남긴다(`POST <경로> answered <상태>`와 k8s `reason`. 응답 본문의 `message`는 객체 값을 담을 수 있어 싣지 않는다). 토큰 · 요청 본문은 남기지 않는다. 설정이 없을 때(위)도 같은 `503 CLUSTER_UNAVAILABLE`이다. 오류 모양은 SRS §2.4(`{ error: { code, message } }`).

## 결정과 대안

| 결정 | 이유 | 버린 대안 |
| --- | --- | --- |
| 연결에 `node:https` | CA를 요청마다 주려면 `undici`가 필요하다. 새 라이브러리를 넣지 않는다 | `undici`의 `Agent` (의존성 추가), `NODE_EXTRA_CA_CERTS`(프로세스 전체의 신뢰 목록이 바뀐다), 검증 끄기(토큰이 가로채일 수 있다) |
| 설정이 없으면 부팅은 되고 사용할 때 `503` | 인프라 값이 오기 전에도 나머지 API를 띄워야 한다 | 필수로 두고 부팅 중단(값이 올 때까지 모든 개발이 막힌다) |
| 일부만 채우면 부팅 중단 | 반쯤 채운 설정이 "없음"으로 조용히 넘어가는 것을 막는다 | 하나라도 없으면 없는 것으로 봄 |
| `409`는 성공 | 다시 불러도 같은 결과여야 한다. 읽기 권한이 없어 먼저 확인할 수도 없다 | 먼저 읽어서 확인(권한 없음), 지우고 다시 만들기(상한 · 차단 규칙 삭제 권한 없음) |
| 객체 값을 코드에 둠 | 서버가 양식 파일을 읽으려면 배포물에 `Infra/`를 싣고 YAML 파서를 넣어야 한다 | 런타임에 `space.yaml` 읽기 |
| 객체를 차례로 보냄 | 순서가 있고(공간 먼저, 권한 연결 마지막), 실패한 곳에서 멈춰야 한다 | 병렬 |

## 알려진 한계

- 양식 값을 코드에 옮겼다. `Infra/student/space.yaml`이 바뀌면 사람이 같이 고친다(테스트가 코드의 값이 양식 파일에 있는지만 본다).
- 이미 있는 공간의 값이 양식과 다른지는 알 수 없다(읽기 권한이 없다).
- 2026-11-11에 유성님(seren-wib)이 실제 리더에 Tailscale로 붙어 #106 커밋 20cefc7로 확인했다(공간 만들기 · 같은 slug 재호출 · 틀린 토큰과 CA 거절 · 읽기 권한, #106 리뷰). 여섯째 객체(실행기 RoleBinding)는 그 뒤에 더해 실제 리더로는 확인하지 않았다(미검증). EC2에서 리더 API까지 닿는 길은 2026-11-12에 확인했고(토큰 없이 `401`), 서버 코드로 부르는 확인은 서버를 EC2에 올린 뒤 한다.
- 여섯 중 일부만 만들어진 채 끊기면 공간이 반쯤 남는다. 같은 `slug`로 다시 부르면 이어서 채운다.
