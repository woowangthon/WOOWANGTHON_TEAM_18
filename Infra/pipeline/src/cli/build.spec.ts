import { describe, expect, it } from 'vitest'
import { configFromEnv } from './build.js'

const env = () => ({
  CODEBUILD_PROJECT: 'student-apps',
  IMAGE_REPO: 'ghcr.io/woowang-bot/student-apps',
  GHCR_USER: 'woowang-bot',
  GHCR_TOKEN_SECRET_ID: 'arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:ghcr-push-AbCdEf',
  PLATFORM_REPO: 'woowangthon/WOOWANGTHON_TEAM_18',
  PLATFORM_COMMIT: 'f'.repeat(40),
})

describe('configFromEnv', () => {
  it('reads the build settings from the runner env', () => {
    expect(configFromEnv(env(), 'spec')).toEqual({
      project: 'student-apps',
      imageRepo: 'ghcr.io/woowang-bot/student-apps',
      ghcrUser: 'woowang-bot',
      ghcrTokenSecretId: 'arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:ghcr-push-AbCdEf',
      platformRepo: 'woowangthon/WOOWANGTHON_TEAM_18',
      platformCommit: 'f'.repeat(40),
      buildspec: 'spec',
    })
  })

  it.each([
    ['CODEBUILD_PROJECT', undefined],
    ['IMAGE_REPO', 'ghcr.io/woowang-bot/other'],
    ['IMAGE_REPO', 'ghcr.io/Woowang-Bot/student-apps'],
    ['GHCR_USER', 'bot name'],
    ['GHCR_TOKEN_SECRET_ID', 'a b'],
    ['PLATFORM_REPO', 'https://github.com/x/y'],
    ['PLATFORM_COMMIT', 'main'],
  ])('stops on a bad %s (%s)', (name, value) => {
    expect(() => configFromEnv({ ...env(), [name]: value }, 'spec')).toThrow(`${name} must look like`)
  })
})
