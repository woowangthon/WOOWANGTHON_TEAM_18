import { readFileSync } from 'node:fs'
import { setTimeout } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { noReportNotice, noticeFrom, parseStage, sendNotice } from '../notify.js'
import { deployIdFromEnv, exitCodeOf, platformFromEnv } from '../platform-api.js'

// GoCD의 알림 task: `node dist/cli/notify.js <build|prepare|render|apply|verify|switch> <스테이지 결과 JSON>`. 환경은 fetch-input과 같다(DEPLOY_ID, PLATFORM_API_URL, PIPELINE_NOTIFY_TOKEN).
// 결과는 `ok`로 정한다: build는 BuildReport, 그 밖은 `{ ok, failure }`. 성공 · 실패 알림을 모두 이 task가 보내므로 `run_if: any` 하나로 부르면 된다.
// 결과 파일이 없거나 JSON으로 읽을 수 없으면(앞 task가 죽었다) 실패로, 플랫폼 문제 코드 `STAGE_NO_REPORT`를 보낸다.
// 종료 코드: 0 보냄(서버가 상태를 바꾸지 않았어도 0: 이미 끝난 배포의 재전송이다), 1 플랫폼 서버가 4xx로 답함(400 · 401 · 404), 2 그 밖(다시 시도한 뒤에도 503 · 연결 실패, 결과의 모양이 틀림, 크래시).

type Sleep = (ms: number) => Promise<void>

/** 테스트가 env와 대기를 넣을 수 있게 main을 나눴다. 종료 코드를 돌려준다. */
export async function run([stageArg, reportPath]: string[], env: NodeJS.ProcessEnv, sleep: Sleep): Promise<number> {
  try {
    if (!stageArg || !reportPath) throw new Error('usage: notify <build|prepare|render|apply|verify|switch> <stage-report.json> (env: DEPLOY_ID, PLATFORM_API_URL, PIPELINE_NOTIFY_TOKEN)')
    const stage = parseStage(stageArg)
    const deployId = deployIdFromEnv(env)
    const conn = platformFromEnv(env)
    let report: unknown
    try {
      report = JSON.parse(readFileSync(reportPath, 'utf8'))
    } catch {
      console.error(`${stage} report ${reportPath} is missing or not JSON: notifying STAGE_NO_REPORT`)
    }
    const body = report === undefined ? noReportNotice(deployId, stage) : noticeFrom(deployId, stage, report)
    const { applied } = await sendNotice(conn, body, sleep)
    console.log(`notified ${stage} ${body.result}${applied ? '' : ' (the server did not change the run: not the current stage, or already finished)'}`)
    return 0
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    return exitCodeOf(err)
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await run(process.argv.slice(2), process.env, (ms) => setTimeout(ms)))
}
