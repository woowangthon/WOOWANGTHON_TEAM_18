import { describe, expect, it } from 'vitest'
import { AwsError, awsErrorCode } from './aws.js'

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
