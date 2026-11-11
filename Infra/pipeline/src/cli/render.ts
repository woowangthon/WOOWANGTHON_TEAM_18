import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { required } from '../config.js'
import { parseDeployInput, type Slot } from '../deploy-input.js'
import { helmTemplate } from '../helm.js'
import { kubeFromEnv, makeKube, makeServerDryRun } from '../kube.js'
import { runRender } from '../render.js'

// GoCD Render 스테이지의 task: `node dist/cli/render.js <배포 입력 JSON(이미지가 채워진 것)> <a|b> <출력 폴더>`.
// 출력 폴더에 slot.yaml(대상 슬롯 앱 + test Ingress), open.yaml(공개 서비스가 있을 때만), render-report.json을 쓴다.
// 실패면 코드 1로 끝나 GoCD job이 실패하고 run_if: failed task가 플랫폼 서버에 알린다.

export const domainFromEnv = (env: NodeJS.ProcessEnv) => required(env, 'BASE_DOMAIN', /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, 'stairnoworks.com')

export function parseSlot(v: string | undefined): Slot {
  if (v !== 'a' && v !== 'b') throw new Error('slot must be a or b')
  return v
}

async function main([inputPath, slotArg, outDir]: string[]) {
  if (!inputPath || !outDir) throw new Error('usage: render <deploy-input.json> <a|b> <out-dir>')
  const slot = parseSlot(slotArg)
  const domain = domainFromEnv(process.env)
  const input = parseDeployInput(readFileSync(inputPath, 'utf8'))
  const dryRun = makeServerDryRun(makeKube(kubeFromEnv(process.env)))
  const report = await runRender(input, slot, domain, { helmTemplate, dryRun })
  mkdirSync(outDir, { recursive: true })
  for (const part of ['slot', 'open'] as const) {
    const manifest = report.manifests[part]
    if (manifest !== null) writeFileSync(join(outDir, `${part}.yaml`), manifest)
  }
  writeFileSync(join(outDir, 'render-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(report.ok ? `rendered slot ${slot}` : `render failed: ${report.failure!.kind}`)
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
