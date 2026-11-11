import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from './exec.js'
import type { Values } from './render.js'

/** 레포의 student-app 차트(Infra/charts/student-app). */
export const CHART_DIR = fileURLToPath(new URL('../../charts/student-app', import.meta.url))

/** `helm template`으로 manifest를 만든다. 클러스터에 닿지 않는다. values는 JSON 파일로 넘긴다(YAML은 JSON을 그대로 읽는다). */
export async function helmTemplate(values: Values, namespace: string, bin = 'helm'): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'student-app-'))
  try {
    const file = join(dir, 'values.json')
    writeFileSync(file, JSON.stringify(values))
    return await run(bin, ['template', 'student-app', CHART_DIR, '--namespace', namespace, '--values', file])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
