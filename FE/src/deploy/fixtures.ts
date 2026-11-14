import type { Explanation } from './progress.ts'
import type { DeploySpecDraft, DraftProject } from './types.ts'

// docs/design/api.md의 deploy-spec 예시(BE는 Dockerfile 있음 · 프레임워크 모름, FE는 vite-react).
export const none = { value: null, source: null }

export const beProject: DraftProject = {
  dir: 'BE',
  framework: none,
  install: { value: 'pnpm install --frozen-lockfile', source: 'lockfile' },
  build: { value: 'pnpm run build', source: 'package.json', script: 'nest build' },
  start: { value: 'pnpm run start', source: 'package.json', script: 'node dist/main' },
  outputDir: none,
  port: none,
  nodeVersion: null,
  lockfile: 'BE/pnpm-lock.yaml',
  dockerfile: true,
  needsReview: ['framework', 'outputDir', 'port'],
}

export const feProject: DraftProject = {
  dir: 'FE',
  framework: { value: 'vite-react', source: 'package.json' },
  install: { value: 'pnpm install --frozen-lockfile', source: 'lockfile' },
  build: { value: 'pnpm run build', source: 'package.json', script: 'tsc -b && vite build' },
  start: none,
  outputDir: { value: 'dist', source: 'default' },
  port: none,
  nodeVersion: '>=22',
  lockfile: 'FE/pnpm-lock.yaml',
  dockerfile: false,
  needsReview: [],
}

export const COMMIT = '0123456789abcdef0123456789abcdef01234567'

export const draftOf = (projects: DraftProject[], truncated = false): DeploySpecDraft => ({
  repo: 'student/my-app',
  commit: COMMIT,
  projects,
  truncated,
})

// 끝난 배포의 설명(Explanation) 시험용 값. 실제 AI가 만든 글이 아니라 시험 전용 대역이다.
export const explanationOf = (extra: Partial<Explanation> = {}): Explanation => ({
  summary: '이번 배포는 새 슬롯에 올려 확인한 뒤 주소를 바꿨어요.',
  steps: [
    { stage: 'build', did: '이미지를 만들었어요', meaning: '코드가 컨테이너가 돼요' },
    { stage: 'switch', did: '주소를 바꿨어요', meaning: '새 버전이 공개돼요' },
  ],
  cause: null,
  actions: [],
  terms: [],
  ...extra,
})
