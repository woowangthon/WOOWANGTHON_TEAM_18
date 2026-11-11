import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { parseDeployInput } from '../deploy-input.js'
import { describe } from '../failure.js'
import { kubeFromEnv, makeKube } from '../kube.js'
import { makeHttpGet, runVerify, traefikFromEnv } from '../verify.js'
import { parseSlot } from './render.js'

// GoCD Verify 스테이지의 task: `node dist/cli/verify.js <배포 입력 JSON> <a|b> <출력 폴더>`. 출력 폴더에 verify-report.json을 쓴다.
// Traefik 주소는 env TRAEFIK_URL(없으면 http://traefik.kube-system:80). 실패면 코드 1로 끝나 run_if: failed task가 플랫폼 서버에 알린다.

async function main([inputPath, slotArg, outDir]: string[]) {
  if (!inputPath || !outDir) throw new Error('usage: verify <deploy-input.json> <a|b> <out-dir>')
  const slot = parseSlot(slotArg)
  const input = parseDeployInput(readFileSync(inputPath, 'utf8'))
  const get = makeHttpGet(traefikFromEnv(process.env))
  const report = await runVerify(input, slot, makeKube(kubeFromEnv(process.env)), get, { sleep: (ms) => setTimeout(ms), now: Date.now })
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'verify-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(report.ok ? `verified slot ${slot}: ${report.ready.length} services Ready, ${report.requests.length} requests 200` : `verify failed: ${describe(report.failure!)}`)
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
