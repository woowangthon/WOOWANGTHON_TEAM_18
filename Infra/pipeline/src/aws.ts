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

/** 셸을 거치지 않고 aws CLI를 부른다(인자에 학생 값이 들어가도 셸이 해석하지 않는다). 자격 증명은 실행기 env에서 CLI가 읽는다. */
export const awsCli: Aws = (args) =>
  new Promise((resolve, reject) => {
    execFile('aws', [...args, '--output', 'json'], { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new AwsError(awsErrorCode(stderr), stderr))
      try {
        resolve(stdout.trim() === '' ? {} : JSON.parse(stdout))
      } catch {
        reject(new AwsError(null, `aws ${args.slice(0, 2).join(' ')} answered output that is not JSON`))
      }
    })
  })
