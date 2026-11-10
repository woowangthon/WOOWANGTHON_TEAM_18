import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { setTimeout } from 'node:timers/promises'
import { awsCli } from '../aws.js'
import { type BuildConfig, runBuilds } from '../build.js'
import { required } from '../config.js'
import { parseDeployInput } from '../deploy-input.js'

// GoCD Build 스테이지의 task: `node dist/cli/build.js <배포 입력 JSON> <결과 JSON>`.
// 결과 파일(BuildReport)은 성공이든 실패든 쓴다. 실패면 코드 1로 끝나 GoCD job이 실패하고 run_if: failed task가 플랫폼 서버에 알린다.

export function configFromEnv(env: NodeJS.ProcessEnv, buildspec: string): BuildConfig {
  return {
    project: required(env, 'CODEBUILD_PROJECT', /^[A-Za-z0-9][A-Za-z0-9_-]{1,254}$/, 'student-apps'),
    imageRepo: required(env, 'IMAGE_REPO', /^ghcr\.io\/[a-z0-9][a-z0-9-]{0,38}\/student-apps$/, 'ghcr.io/<bot>/student-apps'),
    ghcrUser: required(env, 'GHCR_USER', /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/, 'a GitHub user name'),
    ghcrTokenSecretId: required(env, 'GHCR_TOKEN_SECRET_ID', /^[A-Za-z0-9/_+=.@:-]{1,2048}$/, 'a Secrets Manager secret name or ARN'),
    platformRepo: required(env, 'PLATFORM_REPO', /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/, 'owner/name'),
    platformCommit: required(env, 'PLATFORM_COMMIT', /^[0-9a-f]{40}$/, 'a 40-char commit SHA'),
    buildspec,
  }
}

async function main([inputPath, outPath]: string[]) {
  if (!inputPath || !outPath) throw new Error('usage: build <deploy-input.json> <build-report.json>')
  const buildspec = readFileSync(new URL('../../../build/buildspec.yml', import.meta.url), 'utf8')
  const config = configFromEnv(process.env, buildspec)
  const input = parseDeployInput(readFileSync(inputPath, 'utf8'))
  const report = await runBuilds(input, config, awsCli, { sleep: (ms) => setTimeout(ms), now: Date.now })
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`)
  for (const svc of input.spec.services) {
    const failure = report.failures.find((f) => f.service === svc.name)
    const image = report.input.deploy_condition.services[svc.name].image
    console.log(`${svc.name}: ${failure ? `FAILED (${failure.kind === 'platform' ? failure.code : failure.buildStatus})` : (image ?? '-')}`)
  }
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
