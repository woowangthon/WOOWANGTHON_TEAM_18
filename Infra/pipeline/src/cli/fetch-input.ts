import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { fetchInput } from '../fetch-input.js'
import { deployIdFromEnv, exitCodeOf, platformFromEnv, type Sleep } from '../platform-api.js'

// GoCD Build job의 첫 task: `node dist/cli/fetch-input.js <출력 폴더>`. 환경: DEPLOY_ID(GoCD가 넣는다), PLATFORM_API_URL, PIPELINE_NOTIFY_TOKEN.
// 출력 폴더에 deploy-input.json(응답의 `input`, 모양을 확인한 것)과 slot(대상 슬롯 `a` 또는 `b`, 줄바꿈 없음)을 쓴다.
// 종료 코드: 0 성공(두 파일이 있다), 1 플랫폼 서버가 4xx로 답함(입력이나 토큰이 틀림: 다시 해도 같다), 2 그 밖(다시 시도한 뒤에도 503 · 연결 실패, 설정 오류, 크래시).

/** 테스트가 env와 대기를 넣을 수 있게 main을 나눴다. 종료 코드를 돌려준다. */
export async function run([outDir]: string[], env: NodeJS.ProcessEnv, sleep: Sleep): Promise<number> {
  try {
    if (!outDir) throw new Error('usage: fetch-input <out-dir> (env: DEPLOY_ID, PLATFORM_API_URL, PIPELINE_NOTIFY_TOKEN)')
    const deployId = deployIdFromEnv(env)
    const { slot, input } = await fetchInput(platformFromEnv(env), deployId, sleep)
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'deploy-input.json'), `${JSON.stringify(input, null, 2)}\n`)
    writeFileSync(join(outDir, 'slot'), slot)
    console.log(`fetched deploy ${deployId}: slot ${slot}, services ${input.spec.services.map((s) => s.name).join(', ')}`)
    return 0
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    return exitCodeOf(err)
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await run(process.argv.slice(2), process.env, (ms) => setTimeout(ms)))
}
