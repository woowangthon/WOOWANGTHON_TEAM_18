import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AwsError, awsErrorCode, CALL_TIMEOUT_MS, makeAwsCli } from './aws.js'

describe('awsErrorCode', () => {
  it('reads the AWS error name from aws CLI v2 stderr', () => {
    expect(awsErrorCode('\nAn error occurred (AccountLimitExceededException) when calling the StartBuild operation: limit\n')).toBe('AccountLimitExceededException')
  })

  it('is null when stderr has no AWS error', () => {
    expect(awsErrorCode('Unable to locate credentials.')).toBeNull()
  })
})

describe('AwsError', () => {
  it('uses the trimmed stderr as the message', () => {
    expect(new AwsError('X', ' boom \n').message).toBe('boom')
    expect(new AwsError(null, '').message).toBe('aws CLI failed')
  })
})

describe('makeAwsCli', () => {
  let dir: string
  // 받은 인자를 적고, FAKE_MODE에 따라 답하는 가짜 aws.
  const FAKE = `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$FAKE_ARGS"
printf '%s' "$AWS_PAGER|$AWS_RETRY_MODE|$AWS_MAX_ATTEMPTS" > "$FAKE_ENV"
case "$FAKE_MODE" in
  ok) echo '{"build":{"id":"x"}}' ;;
  error) echo 'An error occurred (ThrottlingException) when calling the BatchGetBuilds operation: slow down' >&2; exit 254 ;;
  hang) sleep 30 ;;
esac
`
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aws-cli-'))
    writeFileSync(join(dir, 'aws'), FAKE)
    chmodSync(join(dir, 'aws'), 0o755)
    process.env.FAKE_ARGS = join(dir, 'args')
    process.env.FAKE_ENV = join(dir, 'env')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.FAKE_MODE
  })

  it('parses the JSON answer and passes the CLI time limits, no pager and standard retries', async () => {
    process.env.FAKE_MODE = 'ok'
    await expect(makeAwsCli({ bin: join(dir, 'aws') })(['codebuild', 'start-build'])).resolves.toEqual({ build: { id: 'x' } })
    expect(readFileSync(join(dir, 'args'), 'utf8').trim().split('\n')).toEqual([
      'codebuild', 'start-build', '--output', 'json', '--cli-connect-timeout', '5', '--cli-read-timeout', '15',
    ])
    expect(readFileSync(join(dir, 'env'), 'utf8')).toBe('|standard|3')
  })

  it('reads the AWS error name when the CLI fails', async () => {
    process.env.FAKE_MODE = 'error'
    await expect(makeAwsCli({ bin: join(dir, 'aws') })(['codebuild', 'batch-get-builds'])).rejects.toMatchObject({ code: 'ThrottlingException' })
  })

  it('kills a call that does not answer in time and fails with CLI_TIMEOUT', async () => {
    process.env.FAKE_MODE = 'hang'
    const started = Date.now()
    await expect(makeAwsCli({ bin: join(dir, 'aws'), timeoutMs: 300 })(['codebuild', 'batch-get-builds'])).rejects.toMatchObject({
      code: 'CLI_TIMEOUT',
      message: 'aws codebuild batch-get-builds did not answer in 0.3s',
    })
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('waits 60 seconds by default', () => {
    expect(CALL_TIMEOUT_MS).toBe(60_000)
  })
})
