// SAMPLE(landing-preview): 랜딩 기능 소개의 "예시 화면"이 보이는 데이터. 실제 배포나 서버 응답이 아니라 화면 모양을 보이려고 정해 둔 값이다.
// 보안 검사 문구는 BE/src/security/findings.ts가 만드는 문구와 같은 모양으로 맞췄다.
import type { Step } from '../components/ui/Steps.tsx'

export const AGENT_STEPS: Step[] = [
  { label: '준비 확인', state: 'fail', note: '8080번 포트에서 응답이 없어요' },
  { label: '원인 찾기', state: 'done', note: '앱은 3000번 포트에서 떠 있어요' },
  { label: '설정 고치기', state: 'done', note: '새 슬롯의 runtime.port를 바꿨어요' },
  { label: '다시 확인', state: 'done', note: '응답을 받았어요' },
  { label: '주소 바꾸기', state: 'run' },
]

export const AGENT_LOG = [
  'WARN readiness: connection refused on :8080',
  'INFO app listening on :3000',
  'INFO runtime.port 8080 -> 3000 (slot b)',
].join('\n')

export const AGENT_CHANGE = { field: 'runtime.port', before: '8080', after: '3000', reason: '앱이 3000번 포트에서 요청을 받아요.' }

export const SECURITY_WARNINGS = [
  { code: 'ENV_FILE_COMMITTED', message: '.env 파일이 레포에 올라가 있어요. 비밀값이 들어 있다면 레포에서 지우고 비밀값 입력 단계에서 넣으세요.' },
  {
    code: 'VULNERABLE_DEPENDENCY',
    message: 'package-lock.json의 lodash 4.17.15에 알려진 취약점이 1개 있어요(가장 높은 심각도 HIGH: CVE-2020-8203). 고친 버전: 4.17.19.',
  },
]

export const SLOTS = {
  live: { name: '슬롯 A', version: '이전 버전', state: '공개 중' },
  next: { name: '슬롯 B', version: '새 버전', state: '확인 중' },
}

export const SWITCH_STEPS: Step[] = [
  { label: '새 슬롯에 배포', state: 'done' },
  { label: '준비 확인', state: 'done' },
  { label: '통과하면 주소 바꾸기', state: 'run' },
]

export const METRIC_SERVICES = [
  { name: 'web', state: '실행 중', restarts: 0, cpu: '0.04코어', memory: '70MiB', cpuSeries: [30, 34, 33, 38, 41, 37, 40, 44, 39, 42, 40, 38], memorySeries: [68, 68, 69, 69, 70, 70, 70, 71, 70, 70, 70, 70] },
  { name: 'api', state: '실행 중', restarts: 1, cpu: '0.12코어', memory: '148MiB', cpuSeries: [90, 96, 110, 105, 120, 118, 125, 112, 118, 122, 119, 120], memorySeries: [140, 142, 143, 145, 146, 147, 147, 148, 148, 148, 148, 148] },
]

export const ADMIN_NODES = [
  { name: 'node-1', role: '리더', cpu: 62, memory: 48 },
  { name: 'node-2', role: '워커', cpu: 35, memory: 71 },
]

export const ADMIN_SERVICES = [
  { project: 'my-app', service: 'web', state: '실행 중' },
  { project: 'my-app', service: 'api', state: '실행 중' },
  { project: 'todo-list', service: 'web', state: '시작하는 중' },
]
