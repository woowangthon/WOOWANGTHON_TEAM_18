import { type DeployInput, parseDeployInput, type Slot } from './deploy-input.js'
import { callPlatform, type PlatformConn } from './platform-api.js'

// GoCD의 첫 task: 플랫폼 서버에서 이번 배포의 입력을 가져온다(`GET /api/pipeline/deploys/:deployId/input`, docs/design/api.md).
// 파이프라인은 deployId만 받고(GoCD 환경 변수 DEPLOY_ID), 입력과 대상 슬롯은 여기서 읽어 파일로 넘긴다.

export interface FetchedInput {
  slot: Slot
  input: DeployInput
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** `deployId`는 `deployIdFromEnv`를 거친 값(UUID 소문자)이다. 입력을 가져와 모양을 확인한다(`parseDeployInput`: 뒤 스테이지가 틀린 값으로 CodeBuild · k3s를 부르지 않게). 어긋나면 무엇이 틀렸는지 담아 던진다. */
export async function fetchInput(conn: PlatformConn, deployId: string, sleep: (ms: number) => Promise<void>): Promise<FetchedInput> {
  const body = await callPlatform(conn, 'GET', `/api/pipeline/deploys/${deployId}/input`, undefined, sleep)
  const fail = (what: string) => new Error(`platform server answered an input that is not usable: ${what}`)
  if (!isRecord(body)) throw fail('not an object')
  if (typeof body.deployId !== 'string' || body.deployId.toLowerCase() !== deployId) throw fail('deployId is not the one asked for')
  if (body.slot !== 'a' && body.slot !== 'b') throw fail('slot is neither a nor b')
  if (!isRecord(body.input)) throw fail('input is not an object')
  let input: DeployInput
  try {
    input = parseDeployInput(JSON.stringify(body.input))
  } catch (err) {
    throw fail(err instanceof Error ? err.message : String(err))
  }
  return { slot: body.slot, input }
}
