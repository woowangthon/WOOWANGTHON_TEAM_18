# 실제 scale 호출과 W7 이전 슬롯 내리기

- **SRS**: FR-094, FR-055
- **Owner**: TaeTaeJin
- **Branch**: feat/be-scaler-w7

## Plan

운영자 강제 중지(#123)와 배포 뒤 이전 live 슬롯 정리(#135)는 같은 일(Deployment를 replicas 0으로)이라 한 `DeploymentScaler`로 한다. 자리 채움 `UnwiredDeploymentScaler`를 지우고, 쓰기를 클러스터 호출 모듈(`BE/src/k8s/`)로 옮긴다(#121 `/simplify`에서 권한이 정해진 뒤로 미룬 항목). 호출은 `Infra/platform/check.sh`와 같은 모양이다: `PATCH .../deployments/<이름>/scale`, merge patch.

W7은 `DeployRunsService`의 switch 통과 처리에서, `live_slot`을 바꾼 뒤 이전 슬롯(`targetSlot(run.target_slot)`, 곧 대상 슬롯의 반대쪽)의 `<서비스>-<슬롯>` Deployment를 내린다. 이전 슬롯은 `live_slot`을 읽어 정하지 않고 대상 슬롯의 반대쪽으로 정한다: 알림을 다시 받아 `live_slot`이 이미 대상 슬롯이어도 같은 결과가 되게 하려는 것이다. 첫 배포(`live_slot`이 없다)는 건너뛴다. 내리기가 실패해도 주소가 이미 바뀌었으므로 배포는 `succeeded`로 끝내고 로그만 남긴다.

## Todo

- [x] K8sClient에 PATCH와 Content-Type 인자 — files: `BE/src/k8s/k8s.client.ts`
- [x] `DeploymentScaler`(k8s 모듈) + 테스트, 자리 채움 삭제, AdminModule 바인딩 제거 — files: `BE/src/k8s/deployment-scaler*.ts`, `BE/src/admin/`
- [x] W7: 이전 슬롯 내리기 + e2e — files: `BE/src/deploys/deploy-runs.service.ts`, `BE/test/deploy-runs.e2e.spec.ts`
- [x] 문서: api.md · ai-scope.md · deploy-workflow.md W7
- [ ] 실제 리더 시험 공간에서 한 번 내려 보기(replicas 0, `admin_actions` 기록)

## Done when

- [x] `pnpm verify`가 BE에서 exit 0
- [x] 요청 경로 · 메서드 · Content-Type · 본문, 403 · 422 → ClusterError, 일부 실패 → `failed`, W7이 옛 슬롯 이름만 고르고 첫 배포는 건너뛰는 것을 가짜 응답으로 확인
- [x] 옛 슬롯 고르기의 손 변이 6개가 모두 잡힘
- [ ] 실제 리더에서 내려 보기: **하지 못했다**(PR에 적는다)
