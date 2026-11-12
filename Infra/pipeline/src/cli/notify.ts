import { readFileSync } from 'node:fs'
import { setTimeout } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { NOTIFY_STAGES, type NoticeBody, type NotifyStage, noReportNotice, noticeFrom, parseStage, sendNotice } from '../notify.js'
import { deployIdFromEnv, exitCodeOf, PlatformError, platformFromEnv, type Sleep } from '../platform-api.js'

// GoCD의 알림 task: `node dist/cli/notify.js <build|prepare|render|apply|verify|switch> <스테이지 결과 JSON>`. 환경은 fetch-input과 같다(DEPLOY_ID, PLATFORM_API_URL, PIPELINE_NOTIFY_TOKEN).
// 결과는 `ok`로 정한다: build는 BuildReport, 그 밖은 `{ ok, failure }`. 성공 · 실패 알림을 모두 이 task가 보내므로 `run_if: any` 하나로 부르면 된다.
// 결과 파일이 없거나 JSON이 아니거나 모양이 틀리면(앞 task가 죽었다 · 스테이지 CLI의 버그) 실패로, 플랫폼 문제 코드 `STAGE_NO_REPORT`를 보낸다(이유는 message와 로그에).
// BE가 400으로 거절하면 그 이유를 담은 STAGE_NO_REPORT를 한 번만 더 보낸다(아래 run).
// 종료 코드: 0 보냄(서버가 상태를 바꾸지 않았어도 0: 이미 끝난 배포의 재전송이다. 400 뒤 STAGE_NO_REPORT가 받아들여져도 0), 1 플랫폼 서버가 4xx로 답함(400 · 401 · 404), 2 그 밖(다시 시도한 뒤에도 503 · 연결 실패, 설정 오류, 크래시).

const isNoReport = (body: NoticeBody) => body.result === 'failed' && body.failure.code === 'STAGE_NO_REPORT'

/** 결과 파일을 알림 본문으로 바꾼다. 파일이 없거나 JSON이 아니거나 모양이 틀리면 `STAGE_NO_REPORT`다(알리지 못해 배포가 멈추는 것보다 낫다). 이유는 로그에 남긴다. */
function bodyFrom(deployId: string, stage: NotifyStage, reportPath: string): NoticeBody {
  let report: unknown
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'))
  } catch {
    console.error(`${stage} report ${reportPath} is missing or not JSON: notifying STAGE_NO_REPORT`)
    return noReportNotice(deployId, stage)
  }
  try {
    return noticeFrom(deployId, stage, report)
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    console.error(`${why}: notifying STAGE_NO_REPORT`)
    return noReportNotice(deployId, stage, why)
  }
}

/** 테스트가 env와 대기를 넣을 수 있게 main을 나눴다. 종료 코드를 돌려준다. */
export async function run([stageArg, reportPath]: string[], env: NodeJS.ProcessEnv, sleep: Sleep): Promise<number> {
  try {
    if (!stageArg || !reportPath) throw new Error(`usage: notify <${NOTIFY_STAGES.join('|')}> <stage-report.json> (env: DEPLOY_ID, PLATFORM_API_URL, PIPELINE_NOTIFY_TOKEN)`)
    const stage = parseStage(stageArg)
    const deployId = deployIdFromEnv(env)
    const conn = platformFromEnv(env)
    let body = bodyFrom(deployId, stage, reportPath)
    let applied: boolean
    try {
      ;({ applied } = await sendNotice(conn, body, sleep))
    } catch (err) {
      // BE가 400으로 거절하면(규칙이 어긋났거나 DB 상태에 따른 거절) 그 이유를 담아 STAGE_NO_REPORT를 한 번만 더 보낸다. 400은 BE가 상태를 바꾸기 전에 답해서,
      // 이 알림이 적용되고 배포가 시간 초과까지 멈추지 않는다. 이미 STAGE_NO_REPORT면 반복하지 않고, 401 · 404는 다시 보내도 같다. 두 번째도 거절되면 exit 1이다.
      if (!(err instanceof PlatformError) || err.status !== 400 || isNoReport(body)) throw err
      console.error(`${err.message}: notifying STAGE_NO_REPORT`)
      body = noReportNotice(deployId, stage, `the platform refused the ${body.result} notice (${err.fields.slice(0, 10).map((f) => `${f.path} ${f.code}`).join(', ')})`)
      ;({ applied } = await sendNotice(conn, body, sleep))
    }
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
