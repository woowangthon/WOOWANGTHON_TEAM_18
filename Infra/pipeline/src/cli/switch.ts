import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseDeployInput } from '../deploy-input.js'
import { describe } from '../failure.js'
import { kubeFromEnv, makeKube } from '../kube.js'
import { runSwitch } from '../switch.js'
import { parseSlot } from './render.js'

// GoCD Switch 스테이지의 task: `node dist/cli/switch.js <배포 입력 JSON> <a|b> <Render의 open.yaml> <출력 폴더>`. 출력 폴더에 switch-report.json을 쓴다.
// 공개 서비스가 없으면 Render가 open.yaml을 만들지 않는다. 그 경로에 파일이 없으면 공개 서비스가 없을 때만 open Ingress를 모두 지우고,
// 공개 서비스가 있으면 아무것도 바꾸지 않고 OPEN_MANIFEST_MISSING으로 실패한다.
// 같은 인자로 다시 돌려도 된다(끊긴 전환을 끝낸다). 실패면 코드 1로 끝난다.

async function main([inputPath, slotArg, openPath, outDir]: string[]) {
  if (!inputPath || !openPath || !outDir) throw new Error('usage: switch <deploy-input.json> <a|b> <open.yaml> <out-dir>')
  const slot = parseSlot(slotArg)
  const input = parseDeployInput(readFileSync(inputPath, 'utf8'))
  const open = existsSync(openPath) ? readFileSync(openPath, 'utf8') : null
  const report = await runSwitch(input, slot, open, makeKube(kubeFromEnv(process.env)))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'switch-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(report.ok ? `switched to slot ${slot} (applied ${report.applied.length}, deleted ${report.deleted.length})` : `switch failed: ${describe(report.failure!)}`)
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
