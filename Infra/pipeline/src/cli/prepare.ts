import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseDeployInput } from '../deploy-input.js'
import { describe } from '../failure.js'
import { kubeFromEnv, makeKube } from '../kube.js'
import { runPrepare } from '../prepare.js'
import { parseSlot } from './render.js'

// GoCD Prepare 스테이지의 task: `node dist/cli/prepare.js <배포 입력 JSON> <a|b> <출력 폴더>`. 출력 폴더에 prepare-report.json을 쓴다.
// 실패면 코드 1로 끝나 GoCD job이 실패하고 run_if: failed task가 플랫폼 서버에 알린다.

async function main([inputPath, slotArg, outDir]: string[]) {
  if (!inputPath || !outDir) throw new Error('usage: prepare <deploy-input.json> <a|b> <out-dir>')
  const slot = parseSlot(slotArg)
  const input = parseDeployInput(readFileSync(inputPath, 'utf8'))
  const report = await runPrepare(input, slot, makeKube(kubeFromEnv(process.env)))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'prepare-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(report.ok ? `prepared slot ${slot} (live: ${report.live ?? 'none'}, deleted ${report.deleted.length})` : `prepare failed: ${describe(report.failure!)}`)
  return report.ok ? 0 : 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(2)
    },
  )
}
