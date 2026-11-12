import { readFileSync } from 'node:fs'
import { setTimeout } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { required } from '../config.js'
import { type DeployInput, parseDeployInput } from '../deploy-input.js'
import { exitCodeOf, PlatformError, platformFromEnv, type Sleep, TRIAL_ID } from '../platform-api.js'
import { noReportBody, parseTrialStage, parseTrialStages, sendTrialResult, type Trial, type TrialBody, type TrialStage, trialBodyFrom } from '../trial-report.js'

// student-trial의 결과 보내기 task: `node dist/cli/trial-report.js <build|prepare|render|apply|verify> <스테이지 결과 JSON> <시험 입력 JSON>`.
// 범위 안 스테이지 job마다 `run_if: any`로 부른다. 시험 하나에 한 번만 보낸다: 실패했거나(결과가 없으면 STAGE_NO_REPORT) TRIAL_STAGES의 마지막이면
// `POST /api/pipeline/trials/$TRIAL_ID/result`, 통과한 중간 스테이지는 보내지 않는다. 시험 입력은 그 job의 입력 task가 쓴 deploy-input.json이다(run_deploy의 서비스 목록).
// 환경: TRIAL_ID, TRIAL_STAGES(GoCD가 schedule 값으로 넣는다), PLATFORM_API_URL, PIPELINE_NOTIFY_TOKEN.
// BE가 400으로 거절하면 그 이유를 담은 STAGE_NO_REPORT를 한 번만 더 보낸다(게이트웨이가 30분 기다리지 않게. notify와 같다).
// 종료 코드: 0 보냄 · 보낼 차례가 아님(서버가 받지 않았어도 0: 끝난 시험의 늦은 결과다), 1 플랫폼 서버가 4xx로 답함, 2 그 밖(다시 시도한 뒤에도 503 · 연결 실패, 설정 오류, 크래시).

const isNoReport = (body: TrialBody) => body.result.failure?.code === 'STAGE_NO_REPORT'

/** 결과 파일을 본문으로 바꾼다. 결과 · 입력이 없거나 JSON이 아니거나 모양이 틀리면 STAGE_NO_REPORT다. 보낼 차례가 아니면 null. */
function bodyFrom(trial: Trial, stage: TrialStage, reportPath: string, inputPath: string): TrialBody | null {
  let report: unknown
  let input: DeployInput
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'))
    input = parseDeployInput(readFileSync(inputPath, 'utf8'))
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    console.error(`${stage} report ${reportPath} or input ${inputPath} is missing or unreadable (${why}): sending STAGE_NO_REPORT`)
    return noReportBody(trial, stage)
  }
  try {
    return trialBodyFrom(trial, stage, report, input)
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    console.error(`${why}: sending STAGE_NO_REPORT`)
    return noReportBody(trial, stage, why)
  }
}

/** 테스트가 env와 대기를 넣을 수 있게 main을 나눴다. 종료 코드를 돌려준다. */
export async function run([stageArg, reportPath, inputPath]: string[], env: NodeJS.ProcessEnv, sleep: Sleep): Promise<number> {
  try {
    if (!stageArg || !reportPath || !inputPath) {
      throw new Error('usage: trial-report <build|prepare|render|apply|verify> <stage-report.json> <deploy-input.json> (env: TRIAL_ID, TRIAL_STAGES, PLATFORM_API_URL, PIPELINE_NOTIFY_TOKEN)')
    }
    const stage = parseTrialStage(stageArg)
    const trialId = required(env, 'TRIAL_ID', TRIAL_ID, 'tr_ and 12 hex characters')
    const trial = parseTrialStages(env.TRIAL_STAGES)
    const conn = platformFromEnv(env)
    if (!trial.stages.includes(stage)) {
      // 범위 밖 job은 스테이지 CLI도 이 task도 돌리지 않는다(api.md 4번). 잘못 불렸으면 보내지 않는다(BE는 그런 stage를 400으로 거절한다).
      console.log(`stage ${stage} is not in TRIAL_STAGES ${env.TRIAL_STAGES}: nothing to send`)
      return 0
    }
    let body = bodyFrom(trial, stage, reportPath, inputPath)
    if (body === null) {
      console.log(`${stage} passed; the trial goes on to ${trial.stages[trial.stages.indexOf(stage) + 1]}: nothing to send yet`)
      return 0
    }
    let applied: boolean
    try {
      ;({ applied } = await sendTrialResult(conn, trialId, body, sleep))
    } catch (err) {
      if (!(err instanceof PlatformError) || err.status !== 400 || isNoReport(body)) throw err
      console.error(`${err.message}: sending STAGE_NO_REPORT`)
      body = noReportBody(trial, stage, `the platform refused the trial result (${err.fields.slice(0, 10).map((f) => `${f.path} ${f.code}`).join(', ')})`)
      ;({ applied } = await sendTrialResult(conn, trialId, body, sleep))
    }
    console.log(`sent trial ${trialId} ${stage} ${body.result.ok ? 'passed' : 'failed'}${applied ? '' : ' (the server did not take it: the trial already ended)'}`)
    return 0
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    return exitCodeOf(err)
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await run(process.argv.slice(2), process.env, (ms) => setTimeout(ms)))
}
