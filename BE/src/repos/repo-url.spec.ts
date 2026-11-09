import { describe, expect, it } from 'vitest'
import { parseRepoUrl } from './repo-url.js'

describe('parseRepoUrl accepts', () => {
  it.each([
    ['https://github.com/student/my-app', 'student', 'my-app'],
    ['https://github.com/student/my-app/', 'student', 'my-app'],
    ['https://github.com/student/my-app.git', 'student', 'my-app'],
    ['https://github.com/student/my-app.git/', 'student', 'my-app'],
    ['https://GitHub.com/Student/My_App.v2', 'Student', 'My_App.v2'],
    ['  https://github.com/student/my-app  ', 'student', 'my-app'],
    // .git은 끝에서만 뗀다
    ['https://github.com/student/my.github.io', 'student', 'my.github.io'],
  ])('%s', (input, owner, repo) => {
    expect(parseRepoUrl(input)).toEqual({ owner, repo })
  })
})

describe('parseRepoUrl rejects', () => {
  it.each([
    // 호스트를 속이는 주소
    'https://github.com.evil.io/student/my-app',
    'https://evil.io/github.com/student/my-app',
    'https://www.github.com/student/my-app',
    'https://user@github.com/student/my-app',
    'https://user:pw@github.com/student/my-app',
    'https://github.com:8443/student/my-app',
    'http://github.com/student/my-app',
    'git@github.com:student/my-app.git',
    'github.com/student/my-app',
    // 경로 모양
    'https://github.com/student',
    'https://github.com/',
    'https://github.com/student/my-app/tree/main',
    'https://github.com//my-app',
    'https://github.com/student//my-app',
    'https://github.com/student/.git',
    'https://github.com/student/..',
    // .git을 떼면 . · ..만 남는 이름
    'https://github.com/student/..git',
    'https://github.com/student/...git',
    'https://github.com/student/my%2Fapp',
    'https://github.com/stu dent/my-app',
    `https://github.com/${'a'.repeat(40)}/my-app`,
    `https://github.com/student/${'a'.repeat(101)}`,
    // 쿼리 · 해시
    'https://github.com/student/my-app?tab=readme',
    'https://github.com/student/my-app#readme',
    '',
    'not a url',
  ])('%j', (input) => {
    expect(parseRepoUrl(input)).toBeNull()
  })

  it.each([undefined, null, 123, {}, ['https://github.com/a/b']])('a non-string (%j)', (input) => {
    expect(parseRepoUrl(input)).toBeNull()
  })
})
