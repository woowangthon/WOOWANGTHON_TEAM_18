import { execFile } from 'node:child_process'

/** 바깥 명령 하나를 셸 없이 돌린다. 0이 아닌 코드로 끝나면 stderr(없으면 stdout)를 담아 던진다. `input`은 표준 입력으로 넘긴다. */
export function run(bin: string, args: string[], { input, timeoutMs = 60_000 }: { input?: string; timeoutMs?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, { maxBuffer: 32 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
      if (err) return reject(new Error((err.killed ? `${bin} did not finish in ${timeoutMs / 1000}s` : stderr.trim() || stdout.trim()) || `${bin} failed`))
      resolve(stdout)
    })
    if (input !== undefined) child.stdin?.end(input)
  })
}
