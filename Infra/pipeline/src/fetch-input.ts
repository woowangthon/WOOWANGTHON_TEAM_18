import { type BuildOverrides, parseBuildOverrides } from './build.js'
import { type DeployInput, isRecord, parseDeployInput, type Slot } from './deploy-input.js'
import { callPlatform, type PlatformConn, type Sleep } from './platform-api.js'

// GoCD의 첫 task: 플랫폼 서버에서 이번 배포의 입력을 가져온다(`GET /api/pipeline/deploys/:deployId/input`, docs/design/api.md).
// 파이프라인은 deployId만 받고(GoCD 환경 변수 DEPLOY_ID), 입력과 대상 슬롯은 여기서 읽어 파일로 넘긴다.

export interface FetchedInput {
  slot: Slot
  input: DeployInput
}

export interface FetchedTrialInput extends FetchedInput {
  /** run_build 시험의 StartBuild override. 그 밖의 시험은 null */
  buildOverrides: BuildOverrides | null
}

/** `deployId`는 `deployIdFromEnv`를 거친 값(UUID 소문자)이다. 입력을 가져와 모양을 확인한다(`parseDeployInput`: 뒤 스테이지가 틀린 값으로 CodeBuild · k3s를 부르지 않게). 어긋나면 무엇이 틀렸는지 담아 던진다. */
export async function fetchInput(conn: PlatformConn, deployId: string, sleep: Sleep): Promise<FetchedInput> {
  return checkAnswer(await callPlatform(conn, 'GET', `/api/pipeline/deploys/${deployId}/input`, undefined, sleep), deployId)
}

/**
 * 시험 실행(student-trial)의 입력: `GET /api/pipeline/trials/:trialId/input?counter=<GO_PIPELINE_COUNTER>`(api.md 4번). 범위 안 job마다 첫 task로 읽는다.
 * BE는 counter로 이 GoCD 인스턴스를 기록한다(끝난 시험을 취소할 때 쓴다). 응답은 배포 입력과 같은 모양에 `buildOverrides`(null 또는 override)가 더해진다.
 */
export async function fetchTrialInput(conn: PlatformConn, deployId: string, trialId: string, counter: number, sleep: Sleep): Promise<FetchedTrialInput> {
  const body = await callPlatform(conn, 'GET', `/api/pipeline/trials/${trialId}/input?counter=${counter}`, undefined, sleep)
  const fetched = checkAnswer(body, deployId)
  const raw = (body as Record<string, unknown>).buildOverrides
  let buildOverrides: BuildOverrides | null
  try {
    buildOverrides = parseBuildOverrides(JSON.stringify(raw === undefined ? null : raw))
  } catch (err) {
    throw notUsable(err instanceof Error ? err.message : String(err))
  }
  return { ...fetched, buildOverrides }
}

const notUsable = (what: string) => new Error(`platform server answered an input that is not usable: ${what}`)

function checkAnswer(body: unknown, deployId: string): FetchedInput {
  const fail = notUsable
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
