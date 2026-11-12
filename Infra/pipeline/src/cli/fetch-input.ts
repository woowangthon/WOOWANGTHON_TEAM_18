import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { required } from '../config.js'
import { type FetchedInput, fetchInput, fetchTrialInput } from '../fetch-input.js'
import { deployIdFromEnv, exitCodeOf, type PlatformConn, platformFromEnv, type Sleep } from '../platform-api.js'
import { TRIAL_ID } from '../trial-report.js'

// GoCD Build job의 첫 task: `node dist/cli/fetch-input.js <출력 폴더>`. 환경: DEPLOY_ID(GoCD가 넣는다), PLATFORM_API_URL, PIPELINE_NOTIFY_TOKEN.
// 출력 폴더에 deploy-input.json(응답의 `input`, 모양을 확인한 것)과 slot(대상 슬롯 `a` 또는 `b`, 줄바꿈 없음)을 쓴다.
// 시험 실행(student-trial, env TRIAL_ID가 있음): 범위 안 job마다 첫 task로 `GET /api/pipeline/trials/$TRIAL_ID/input?counter=$GO_PIPELINE_COUNTER`를 읽고,
// 두 파일에 더해 build-overrides.json(run_build의 override, 그 밖의 시험은 `null`)을 쓴다(api.md "파이프라인 ↔ 플랫폼 서버" 4번).
// 종료 코드: 0 성공(파일이 모두 있다), 1 플랫폼 서버가 4xx로 답함(입력이나 토큰이 틀림, 끝난 시험의 404: 다시 해도 같다), 2 그 밖(다시 시도한 뒤에도 503 · 연결 실패, 설정 오류, 크래시).

/** 테스트가 env와 대기를 넣을 수 있게 main을 나눴다. 종료 코드를 돌려준다. */
export async function run([outDir]: string[], env: NodeJS.ProcessEnv, sleep: Sleep): Promise<number> {
  try {
    if (!outDir) throw new Error('usage: fetch-input <out-dir> (env: DEPLOY_ID, PLATFORM_API_URL, PIPELINE_NOTIFY_TOKEN; in a trial also TRIAL_ID, GO_PIPELINE_COUNTER)')
    const deployId = deployIdFromEnv(env)
    const trial = env.TRIAL_ID === undefined ? null : trialFromEnv(env)
    const conn = platformFromEnv(env)
    const { slot, input } = trial === null ? await fetchInput(conn, deployId, sleep) : await fetchTrial(conn, deployId, trial, outDir, sleep)
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'deploy-input.json'), `${JSON.stringify(input, null, 2)}\n`)
    writeFileSync(join(outDir, 'slot'), slot)
    console.log(`fetched ${trial === null ? 'deploy' : `trial ${trial.id} of deploy`} ${deployId}: slot ${slot}, services ${input.spec.services.map((s) => s.name).join(', ')}`)
    return 0
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    return exitCodeOf(err)
  }
}

/** 시험 입력을 읽고 build-overrides.json(run_build가 아니면 `null`)을 쓴다. 나머지 두 파일은 배포 입력과 같이 run이 쓴다. */
async function fetchTrial(conn: PlatformConn, deployId: string, trial: { id: string; counter: number }, outDir: string, sleep: Sleep): Promise<FetchedInput> {
  const { slot, input, buildOverrides } = await fetchTrialInput(conn, deployId, trial.id, trial.counter, sleep)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'build-overrides.json'), `${JSON.stringify(buildOverrides)}\n`)
  return { slot, input }
}

/** 시험의 id(요청 경로에 들어가므로 `tr_<hex 12자>`만)와 GoCD 인스턴스 번호(GoCD가 job마다 넣는 GO_PIPELINE_COUNTER). */
function trialFromEnv(env: NodeJS.ProcessEnv): { id: string; counter: number } {
  const id = required(env, 'TRIAL_ID', TRIAL_ID, 'tr_ and 12 hex characters')
  const counter = Number(required(env, 'GO_PIPELINE_COUNTER', /^[1-9][0-9]{0,8}$/, 'a positive integer (GoCD sets it in every job)'))
  return { id, counter }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await run(process.argv.slice(2), process.env, (ms) => setTimeout(ms)))
}
