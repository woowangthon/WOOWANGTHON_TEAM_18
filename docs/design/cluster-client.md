# 클러스터 호출 모듈 — 설계

- **상태**: 초안 (2026-11-11, 이슈 [#111](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/111). 실제 리더에서 확인함, 아래 "실제 리더 확인")
- **관련**: [space.md](space.md)(연결 설정 · 공간 만들기, #81), [cluster.md](cluster.md) §8(서버 권한과 응답 코드) · §12(비밀값), [deploy-workflow.md](deploy-workflow.md) W3, [ADR-004](../adr/README.md) · [ADR-009](../adr/009-deploy-runs-on-leader-gocd-agent.md)

## 범위

플랫폼 서버(BE)의 `BE/src/k8s`가 서버 안의 다른 모듈에 내놓는 함수다. 연결 설정(`K8S_*`)과 공간 만들기는 [space.md](space.md)가 정했고, 이 문서는 그 위에 얹는 부분만 다룬다.

- 하는 것: 호출 도우미를 `request(method, …)`로 넓히고 연결을 재사용하기, 오류를 종류로 나누기(`ClusterError`), 비밀값 쓰기, 읽기(Pod · 로그 · Deployment · 노드).
- 하지 않는 것: 사용자가 부르는 HTTP 엔드포인트와 DB. 비밀값 받기 API · `secretHash` · 상태 저장은 #43, 운영자 API는 #100이 이 함수를 불러서 만든다. FE가 보는 계약이 없으므로 [api.md](api.md)는 바뀌지 않는다.
- 서버 계정이 할 수 있는 것은 [cluster.md §8](cluster.md#8-플랫폼-서버와-배포-실행기의-권한-서버-계정-1차-구현됨-2026-11-10-나머지-예정)이 정한다. 여기서는 그 권한 안에서만 부른다.

## 설계

### 내놓는 함수

`K8sModule`이 서비스 셋을 내놓는다. 인자의 `slug` · `service`는 배포 입력 검증([api.md](api.md))을 통과한 값이어야 하고, 아니면 던진다(요청 경로에 들어가는 값이다). 공간 이름은 함수가 `proj-<slug>`로 만들기 때문에 `kube-system` 같은 다른 공간은 인자로 가리킬 수 없다.

| 함수 | 하는 일 | 요청 |
| --- | --- | --- |
| `SpaceService.ensureSpace(slug)` | 공간 객체 여섯 만들기 ([space.md](space.md), 바뀌지 않음) | `POST` 여섯 |
| `ClusterSecrets.write(slug, service, values)` | Secret `<service>-secrets`에 `values`(`{ key: 값 }`)를 넣는다. 이미 있으면 통째로 바꾼다 | `POST /api/v1/namespaces/proj-<slug>/secrets` → `409`면 `PUT /api/v1/namespaces/proj-<slug>/secrets/<service>-secrets` |
| `ClusterReader.pods(slug)` | 공간의 Pod 목록 | `GET /api/v1/namespaces/proj-<slug>/pods` |
| `ClusterReader.logs(slug, pod, { container, tailLines })` | Pod 로그의 끝부분(글) | `GET /api/v1/namespaces/proj-<slug>/pods/<pod>/log?tailLines=…&limitBytes=…` |
| `ClusterReader.deployments(slug)` | 공간의 Deployment 목록 | `GET /apis/apps/v1/namespaces/proj-<slug>/deployments` |
| `ClusterReader.nodes()` | 노드 목록 | `GET /api/v1/nodes` |

### 호출 도우미

`K8sClient`가 하는 일은 둘이다.

- `request(method, path, body?)`: 요청 하나를 보내고 `2xx`면 응답 본문(글)을 돌려준다. 그 밖은 `ClusterError`를 던진다.
- `create(path, body)`: `POST`. `201`이면 `'created'`, `409 AlreadyExists`면 `'exists'`를 돌려준다(오류 로그 없음). #106에서는 값을 돌려주지 않았는데, 비밀값 쓰기가 "이미 있음"을 알아야 `PUT`으로 넘어갈 수 있어 값을 돌려주게 했다. `ensureSpace`는 둘 다 성공으로 본다.

연결은 클라이언트가 가진 agent 하나로 재사용한다(keep-alive). 한 번의 배포에서 공간 여섯 + Secret, 운영자 화면에서 공간마다 Pod · Deployment를 연달아 부르는데, 요청마다 TLS 연결을 새로 맺으면 Tailscale 구간에서 그만큼 왕복이 늘어난다. 쉬는 연결은 5초 뒤 닫는다(Node 기본 agent와 같은 값): 오래 쉰 연결은 중간(Tailscale · NAT)에서 소리 없이 끊겨 있을 수 있고, 그 연결로 보낸 `POST`는 다시 보내도 되는지 알 수 없다. 동시 연결은 8개로 묶는다. 요청 하나의 제한 시간 5초, 인증서 검증, 토큰을 `K8S_API_URL`로만 보내는 것은 space.md 그대로다.

### 오류 나누기

실패는 모두 `ClusterError`다. `ClusterError`는 `503 CLUSTER_UNAVAILABLE`(space.md의 오류 모양)을 그대로 물려받아서, **부르는 쪽이 잡지 않으면 지금처럼 `503`** 이 나간다. 잡으면 `kind`로 가른다.

| `kind` | 언제 | 부르는 쪽이 잡을 만한 경우 |
| --- | --- | --- |
| `unconfigured` | `K8S_*`가 비어 있음 | 없음 (`503`) |
| `unreachable` | 연결 실패 · 인증서 검증 실패 · 시간 초과 | 운영자 화면의 "리더 무응답" 표시 |
| `unauthorized` | `401` 토큰이 틀림 · 폐기됨 | 없음 (설정 문제) |
| `forbidden` | `403` 권한 없음 | 읽기에서: 서버가 만들지 않은 공간(권한 연결 `platform-server-read`가 없음). "아직 공간 없음"으로 볼 수 있다 |
| `not_found` | `404` | 로그 읽기에서: Pod가 그 사이 사라짐 |
| `conflict` | `409` (`create`의 `AlreadyExists`는 오류가 아니다) | 없음 |
| `rejected` | `422` 검사 규칙 · 값 검증이 거절 | 비밀값 쓰기에서: key 이름이 Secret 규칙(`[-._a-zA-Z0-9]+`)에 맞지 않음. 미리 걸러야 하는 값이라 보통은 코드의 문제다 |
| `unexpected` | 그 밖의 상태(`400` · `5xx` 등), 읽을 수 없는 응답 | 로그 읽기의 `400`: 컨테이너가 아직 시작 전(`apiStatus`로 확인) |

`ClusterError`에는 `kind`와 함께 쿠버네티스가 답한 상태 `apiStatus`와 Status의 reason `apiReason`이 실린다(HTTP 예외의 `status`는 늘 `503`이다). 응답의 `message`는 싣지 않는다: 객체 값이 들어갈 수 있다. 로그도 같다(`<메서드> <경로> answered <상태> <reason>` 또는 `failed: <오류 코드>`). 토큰 · 요청 본문 · 응답 본문은 로그와 오류에 남기지 않는다.

`401` · `403` · `422`를 사용자에게 `4xx`로 넘기지 않는 것은 space.md와 같다: 사용자 잘못이 아니라 서버 설정이나 코드의 문제다.

### 비밀값 쓰기

- 객체: `v1/Secret`, 이름 `<service>-secrets`, 타입 `Opaque`, 값은 `data`(base64). 이름과 타입은 검사 규칙 `wanggane-platform-server`가 이것만 통과시킨다.
- `values`가 Secret의 **전부**다. 다시 쓰면 통째로 바뀌므로 빠진 key는 지워진다. 일부만 고치는 함수는 없다(아래 "일부러 없는 것").
- 순서: `POST`로 만들고, `409 AlreadyExists`면 같은 객체를 `PUT`으로 보낸다. `resourceVersion` 없이 보내므로 나중에 쓴 쪽이 이긴다. 같은 서비스의 비밀값을 동시에 두 번 넣는 경우의 순서는 부르는 쪽(#43)이 정한다.
- 공간이 없으면 `POST`가 `404`(`not_found`)다. 공간을 먼저 만드는 것(`ensureSpace`)은 부르는 쪽의 순서다.
- `PUT`의 응답에는 보낸 값이 들어 있다. 모듈은 응답 본문을 돌려주지도 남기지도 않는다.

### 읽기

쿠버네티스 응답을 그대로 넘기지 않고 아래 칸만 골라 돌려준다. Pod 응답 전체에는 컨테이너의 env 값이 들어 있어서, 그대로 넘기면 부르는 쪽이 실수로 사용자 응답에 실을 수 있다. 칸은 #98(진행 상태) · #100(운영자 화면)이 적은 것만 넣었고, 더 필요하면 그때 더한다.

| 함수 | 돌려주는 것 |
| --- | --- |
| `pods` | `name`, `labels`, `phase`, `node`(놓인 노드), `ready`(컨테이너가 모두 준비됨), `restarts`(컨테이너 재시작 횟수의 합), `waiting`(기다리는 컨테이너 — init 컨테이너 포함 — 의 이유: `CrashLoopBackOff` · `ImagePullBackOff` 등, 없으면 `null`) |
| `deployments` | `name`, `labels`, `replicas`(원하는 수), `ready`, `updated`, `available` |
| `nodes` | `name`, `ready`, `roles`(`node-role.kubernetes.io/<역할>` 라벨에서), `capacity` · `allocatable`(`cpu` · `memory` · `ephemeral-storage`, 쿠버네티스 수량 글 그대로) |
| `logs` | 글. `tailLines` 기본 200(최대 2000), 응답은 256 KiB에서 자른다(요청 하나의 제한 시간 5초 안에 느린 구간으로도 받을 크기). 이어 받기(follow)는 없다 |

- 목록은 한 번에 받는다(쪽 나눔 없음). 공간 하나의 Pod는 상한(ResourceQuota)으로 묶여 있고 노드는 셋이다.
- 실제 사용량(CPU · 메모리)은 이 모듈에 아직 없다. 권한은 들어갔다([cluster.md](cluster.md) §8, #130): `GET /apis/metrics.k8s.io/v1beta1/nodes`와 `/apis/metrics.k8s.io/v1beta1/namespaces/<공간>/pods`. 응답은 다른 목록처럼 `items` 배열이고, 항목의 `metadata.name`이 노드 · Pod 이름과 같다. 값은 쿠버네티스 수량 글이다(실제 리더 응답: 노드는 `usage`에 CPU `123018642n`(나노코어) · 메모리 `6838040Ki`, Pod는 `containers[].usage`에 같은 모양). 갓 뜬 Pod와 노드는 첫 수집(수십 초) 전까지 목록에 없으므로 없는 항목은 오류가 아니라 "아직 없음"이다. 운영자 API의 응답에는 Pod 사용량 자리가 아직 없다([api.md](api.md)는 노드의 `usage`만 정한다). Pod 사용량을 화면에 내려면 api.md부터 고친다. 호출은 다음 PR. 디스크 사용량 · 지난 값은 Prometheus에 묻는다(2026-11-11부터 된다, [cluster.md](cluster.md) §10): `GET /api/v1/namespaces/monitoring/services/monitoring-prometheus:9090/proxy/api/v1/query?query=<PromQL>`. `GET`만 된다.

### 일부러 없는 것

| 없는 것 | 이유 |
| --- | --- |
| `PATCH` | 서버 계정에 Secret `patch` 권한이 없다. patch의 응답은 Secret 전체라, 빈 patch 하나로 값을 읽을 수 있기 때문이다(cluster.md §8). 다른 객체도 고치기 권한이 없다 |
| Secret 읽기 · 목록 · 삭제 | 권한이 없다(`403`). 어떤 key가 들어갔는지는 #43이 DB에 key 이름으로 남긴다 |
| 조치(scale · 재시작), watch · 이벤트 읽기 | 끄기 · 재개(scale 0 · 1), 재시작(rollout restart), 이벤트 · Ingress 읽기 권한은 2026-11-11에 들어갔다([cluster.md](cluster.md) §8, #124 · #129). 호출은 다음 PR |
| 공간 삭제 | 서버 계정에 권한은 있지만 부르는 기능이 아직 없다 |
| 다시 시도 | `POST`는 다시 보내도 되는지 모듈이 알 수 없다. 다시 부르는 것은 부르는 쪽이 정한다(`ensureSpace`와 `write`는 다시 불러도 같은 결과다) |

### 실제 리더 확인

2026-11-11, 운영자 기기(Tailscale)에서 서버 계정의 실제 토큰으로, 임시 공간 `proj-clicheck-1111`에서 했다. 끝난 뒤 공간을 지웠다.

| 한 것 | 결과 |
| --- | --- |
| `ensureSpace` | 다섯 객체 `201`, 101 ms (#106의 여섯째 객체 실행기 RoleBinding이 더해지기 전 코드로 확인) |
| `write` 첫 번째 | `POST` 하나, `201` |
| `write` 두 번째 · 세 번째(값 없음) | `POST` `409 AlreadyExists` → `PUT` `200`, 32 ms |
| `pods` · `deployments` (새 공간) | 빈 목록 |
| `pods` · `deployments` · `logs` (`proj-demo`) | Pod 1 · Deployment 1, 로그 끝 5줄 요청에 2줄 |
| `nodes` | 셋 모두 Ready, 역할(리더 `control-plane` · `etcd`, 워커는 없음), 수량 세 가지 |
| 없는 Pod의 로그 | `404` → `not_found` |
| 서버가 만들지 않은 공간 · 지운 공간 읽기 | `403` → `forbidden` |
| Secret 목록 · 읽기 · patch · 삭제 | `403` → `forbidden` |
| `proj-` 밖(`default`)에 Secret 쓰기, 다른 이름 · 토큰 타입 Secret (server dry run) | `422` → `rejected` |
| 규칙에 맞지 않는 key 이름 | `422` → `rejected` |
| 공간 삭제 | `200`, 6초 뒤 사라짐 |
| 로그 | 실패 11줄 모두 `<메서드> <경로> answered <상태> <reason>` 모양. 토큰 · 리더 주소 · 값 없음 |

## 결정과 대안

| 결정 | 이유 | 버린 대안 |
| --- | --- | --- |
| `ClusterError`가 `503` 예외를 물려받음 | 잡지 않은 오류가 지금과 같은 `503 CLUSTER_UNAVAILABLE`로 나간다. #106의 동작과 시험이 그대로다 | 결과 값으로 돌려주기(부르는 곳마다 갈라야 한다), 종류마다 다른 HTTP 상태(서버 설정 문제가 사용자에게 `4xx`로 보인다) |
| 이미 있으면 `PUT` | 서버 계정이 가진 고치기는 통째로 바꾸기(`update`)뿐이다. 응답에 보낸 값만 있다 | `PATCH`(권한 없음), 지우고 다시 만들기(Secret 삭제 권한 없음, 그 사이 Pod가 뜨면 실패) |
| `POST` 먼저, `409`면 `PUT` | 읽기 권한이 없어 있는지 먼저 볼 수 없다. 첫 배포는 요청 하나로 끝난다 | `PUT` 먼저 하고 `404`면 `POST`(첫 배포마다 오류 응답이 하나 생기고, 공간이 없을 때의 `404`와 구분되지 않는다) |
| 값을 `data`(base64)로 보냄 | 보낸 객체가 곧 저장되는 객체다 | `stringData`(쓰기 전용 칸이라 `data`와 합쳐지는 규칙을 알아야 한다) |
| 읽기 결과를 골라서 돌려줌 | Pod의 env 값 같은 것이 부르는 쪽으로 넘어가지 않는다. 쿠버네티스 응답 모양이 서버 전체로 퍼지지 않는다 | 응답 그대로(`unknown`) 넘기기 |
| 연결 재사용, 쉬는 연결 5초 | 연달아 부르는 요청의 TLS 왕복을 줄이고, 죽은 연결로 `POST`를 보내는 일을 줄인다 | 요청마다 새 연결, 길게 유지(끊긴 연결로 보낸 요청이 실패한다) |
| 새 라이브러리 없음 | space.md와 같다(`node:https`) | 공식 클라이언트 `@kubernetes/client-node`(의존성이 크고, 쓰는 호출이 여섯 가지뿐이다) |

## 알려진 한계

- `write`는 두 요청(`POST` → `PUT`) 사이에 Secret이 지워지면 `404`로 실패한다. 다시 부르면 된다.
- 이미 있는 Secret의 값이 무엇인지 서버는 알 수 없다(읽기 권한 없음). "들어갔는지"는 부르는 쪽이 자기가 쓴 기록으로 판단한다.
- Secret 값이 바뀌어도 도는 Pod는 그대로다. Pod를 다시 띄우는 것은 `secretHash`(#43)와 배포 파이프라인의 일이다.
- 서버가 만들지 않은 공간(예: 손으로 만든 `proj-demo` 말고 권한 연결이 없는 공간)은 읽지 못한다(`forbidden`).
- 부르는 쪽이 잡는 `403` · `404`(아직 없는 공간, 사라진 Pod)도 모듈은 오류 수준으로 로그를 남긴다. 예상한 경우인지는 모듈이 알 수 없다. 자주 읽는 화면에서는 로그가 시끄러울 수 있다.
- `422`의 로그에는 상태와 reason뿐이라 어느 검사 규칙이 거절했는지 남지 않는다(응답 `message`에 객체 값이 섞일 수 있어 싣지 않는다). 규칙 이름은 같은 요청을 운영자 계정으로 dry run 해서 본다.
- 로그는 끝부분만 한 번 읽는다. 이어 받기와 지난 컨테이너(`previous`) 로그는 없다.
- EC2에서 리더에 닿는지는 확인하지 않았다(EC2가 사설망에 들어온 뒤). 실제 리더 확인은 운영자 기기에서 했다.
- 실제 리더에서 `PUT` 뒤 Secret의 key가 통째로 바뀌었는지는 보지 않았다(서버 계정은 읽지 못한다). 응답이 `200`인 것까지 확인했다.
