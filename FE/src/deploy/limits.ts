// 배포 입력의 허용 값과 길이 제한. 한 곳에 모아 두어 BE 검증이 바뀌면 여기만 고친다.
// 서버가 최종 검증이다(docs/design/api.md "배포 입력 저장"). FE는 이 값으로 명백한 것만 미리 막는다.
// slug · 서비스 이름 길이와 시작 대기 시간은 docs/design/deploy-handoff.md의 검증 규칙이고 BE #80이 맞출 값이다.
// api.md의 현재 표는 아직 1~58 · 1~52 · 1~600이다.

export const SLUG_MAX = 40
export const NAME_MAX = 30
export const TIMEOUT_MIN = 5
export const TIMEOUT_MAX = 300
export const MAX_SERVICES = 3
export const STATIC_PORT = 8080
// 예약 이름의 정본은 docs/design/cluster.md §9다. 서버의 저장 검사가 최종이다.
export const RESERVED_SLUGS = [
  ...['app', 'api', 'www', 'admin', 'account', 'auth', 'login', 'platform', 'dashboard', 'status', 'docs', 'blog', 'cdn', 'static', 'grafana'],
  ...['mail', 'smtp', 'demo', 'test', 'dev', 'staging', 'default', 'kube-system'],
]

export const ROLES = ['fe', 'be', 'ai'] as const
export const FRAMEWORKS = ['vite-react', 'nextjs', 'nest'] as const
export const HEALTH_TYPES = ['http', 'tcp'] as const

export const SLUG_PATTERN = new RegExp(`^[a-z0-9]([a-z0-9-]{0,${SLUG_MAX - 2}}[a-z0-9])?$`)
export const NAME_PATTERN = new RegExp(`^[a-z]([a-z0-9-]{0,${NAME_MAX - 2}}[a-z0-9])?$`)
export const NODE_VERSION_PATTERN = /^\d{1,2}(\.\d{1,3}){0,2}$/

// 역할마다 처음 채워 주는 공개 경로. `ai`는 내부 전용이다.
export const DEFAULT_INGRESS: Record<(typeof ROLES)[number], string> = { fe: '/', be: '/api', ai: '' }
