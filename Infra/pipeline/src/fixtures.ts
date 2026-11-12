import type { DeployInput } from './deploy-input.js'

// 테스트용 배포 입력: docs/design/deploy-handoff.md 예시의 FE(Dockerfile 없음) · BE(Dockerfile 있음) · AI(내부 전용).
export const HASH_FE = `sha256:${'1'.repeat(12)}${'a'.repeat(52)}`
export const HASH_BE = `sha256:${'2'.repeat(12)}${'b'.repeat(52)}`
export const HASH_AI = `sha256:${'3'.repeat(12)}${'c'.repeat(52)}`
export const IMAGE_REPO = 'ghcr.io/woowang-bot/student-apps'
export const digest = (c: string) => `${IMAGE_REPO}@sha256:${c.repeat(64)}`
export const COMMIT = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

/** 빌드가 끝난 뒤의 입력: 빌드한(`run`) fe · be에 이미지가 채워져 있다. */
export const builtDeployInput = (): DeployInput => {
  const input = deployInput()
  input.deploy_condition.services.fe.image = digest('1')
  input.deploy_condition.services.be.image = digest('2')
  return input
}

export const deployInput = (): DeployInput => ({
  commitSha: COMMIT,
  deploy_condition: {
    secretHash: null,
    services: {
      fe: { buildInputHash: HASH_FE, build: 'run', image: null },
      be: { buildInputHash: HASH_BE, build: 'run', image: null },
      ai: { buildInputHash: HASH_AI, build: 'reuse', image: digest('9') },
    },
  },
  spec: {
    project: { slug: 'my-app', repo: 'student/my-app' },
    services: [
      {
        name: 'fe',
        role: 'fe',
        dir: 'FE',
        build: {
          context: 'FE',
          dockerfile: null,
          framework: 'vite-react',
          nodeVersion: '22',
          install: 'pnpm install --frozen-lockfile',
          build: 'pnpm run build',
          start: null,
          outputDir: 'dist',
          buildEnv: { VITE_API_URL: '/api', VITE_TITLE: 'a b "c" =d' },
        },
        runtime: {
          kind: 'static',
          port: 8080,
          health: { type: 'http', path: '/', startupTimeoutSeconds: 10 },
          env: {},
          secretKeys: [],
          links: [],
          ingressPath: '/',
          stripPrefix: false,
          resources: null,
        },
      },
      {
        name: 'be',
        role: 'be',
        dir: 'BE',
        build: {
          context: '.',
          dockerfile: 'BE/Dockerfile',
          framework: null,
          nodeVersion: null,
          install: null,
          build: null,
          start: null,
          outputDir: null,
          buildEnv: {},
        },
        runtime: {
          kind: 'server',
          port: 3000,
          health: { type: 'http', path: '/api/health', startupTimeoutSeconds: 60 },
          env: { NODE_ENV: 'production' },
          secretKeys: ['DATABASE_URL'],
          links: [{ env: 'AI_URL', service: 'ai' }],
          ingressPath: '/api',
          stripPrefix: false,
          resources: null,
        },
      },
      {
        name: 'ai',
        role: 'ai',
        dir: 'AI',
        build: {
          context: 'AI',
          dockerfile: 'AI/Dockerfile',
          framework: null,
          nodeVersion: null,
          install: null,
          build: null,
          start: null,
          outputDir: null,
          buildEnv: {},
        },
        runtime: {
          kind: 'server',
          port: 8000,
          health: { type: 'http', path: '/health', startupTimeoutSeconds: 120 },
          env: {},
          secretKeys: ['OPENAI_API_KEY'],
          links: [],
          ingressPath: null,
          stripPrefix: false,
          resources: null,
        },
      },
    ],
  },
})
