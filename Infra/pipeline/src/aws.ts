import { execFile } from 'node:child_process'

/** `aws <args> --output json`의 JSON 답. 테스트는 이 함수 자리에 대역을 넣는다. */
export type Aws = (args: string[]) => Promise<unknown>

/** aws CLI가 0이 아닌 코드로 끝났다. `code`는 AWS 오류 이름(`AccountLimitExceededException` 등)이고, 못 읽으면 null이다. */
export class AwsError extends Error {
  constructor(
    readonly code: string | null,
    readonly stderr: string,
  ) {
    super(stderr.trim() || 'aws CLI failed')
  }
}

// aws CLI v2의 오류 줄: "An error occurred (AccountLimitExceededException) when calling the StartBuild operation: ..."
const ERROR_CODE = /An error occurred \(([A-Za-z0-9]+)\)/

export const awsErrorCode = (stderr: string): string | null => ERROR_CODE.exec(stderr)?.[1] ?? null

// 호출 하나의 상한. 평소 1~2초인 호출이 네트워크가 반쯤 끊겨 멈추면, 대기 루프의 20분 검사까지 가지 못하고 GoCD job 제한(30분)에서야 끊긴다.
// CLI 자체도 시도마다 연결 5초 · 응답 15초로 묶고 표준 재시도 3번까지라, 정상적인 재시도는 이 안에 끝난다.
export const CALL_TIMEOUT_MS = 60_000
const CLI_ARGS = ['--output', 'json', '--cli-connect-timeout', '5', '--cli-read-timeout', '15']

/**
 * 셸을 거치지 않고 aws CLI를 부른다(인자에 학생 값이 들어가도 셸이 해석하지 않는다). 자격 증명은 실행기 env에서 CLI가 읽는다.
 * `timeoutMs` 안에 끝나지 않으면 프로세스를 죽이고 code `CLI_TIMEOUT`으로 실패한다. `bin`은 테스트가 가짜 aws를 넣는 자리다.
 */
export function makeAwsCli({ timeoutMs = CALL_TIMEOUT_MS, bin = 'aws' } = {}): Aws {
  return (args) =>
    new Promise((resolve, reject) => {
      const env = { ...process.env, AWS_PAGER: '', AWS_RETRY_MODE: 'standard', AWS_MAX_ATTEMPTS: '3' }
      execFile(bin, [...args, ...CLI_ARGS], { maxBuffer: 32 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL', env }, (err, stdout, stderr) => {
        if (err && err.killed) return reject(new AwsError('CLI_TIMEOUT', `aws ${args.slice(0, 2).join(' ')} did not answer in ${timeoutMs / 1000}s`))
        if (err) return reject(new AwsError(awsErrorCode(stderr), stderr))
        try {
          resolve(stdout.trim() === '' ? {} : JSON.parse(stdout))
        } catch {
          reject(new AwsError(null, `aws ${args.slice(0, 2).join(' ')} answered output that is not JSON`))
        }
      })
    })
}

export const awsCli: Aws = makeAwsCli()
