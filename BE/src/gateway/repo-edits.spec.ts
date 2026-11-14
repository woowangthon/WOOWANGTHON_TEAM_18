import { Logger } from '@nestjs/common'
import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { type BaseEntry, BotError, type BotRepo, type PullOutcome } from './bot-repo.js'
import { checkEditArgs, RepoEdits, type SourceRef } from './repo-edits.js'
import type { GatewayTicket } from './tickets.js'

const BASE = '0123456789abcdef0123456789abcdef01234567'
const TOKEN = `ghp_${'s'.repeat(36)}`

const ticket = (id = 't_a'): GatewayTicket => ({ deployId: 'd', ticketId: id, slug: 'my-app', repo: 'student/app', commitSha: BASE, targetSlot: 'b', services: ['be'], failure: null, expiresAt: 0, ticketStart: 0 })

const lines = (n: number, prefix = 'line') => Array.from({ length: n }, (_, i) => `${prefix} ${i}`).join('\n')

// 가짜 봇 GitHub: 학생 레포의 BASE commit 파일 목록과 내용을 갖고, 한 일을 기록한다.
class FakeBot {
  token = true
  files = new Map<string, { mode: string; type: string; content: Buffer }>()
  forks: string[] = []
  commits: { fork: string; parent: string; baseTree: string; branch: string; files: { path: string; mode: string; content: string }[]; message: string }[] = []
  moves: { branch: string; sha: string }[] = []
  pulls: { upstream: string; branch: string; title: string; body: string }[] = []
  pullOutcome: PullOutcome = { opened: true, url: 'https://github.com/student/app/pull/7' }
  failWith: BotError | Error | null = null
  gate: Promise<void> | null = null
  truncated = false

  available = () => this.token
  fork(repo: string): Promise<string> {
    this.forks.push(repo)
    return this.failWith ? Promise.reject(this.failWith) : Promise.resolve('wanggane-bot/app')
  }
  tree(): Promise<{ treeSha: string; entries: Map<string, BaseEntry>; truncated: boolean }> {
    const entries = new Map<string, BaseEntry>()
    for (const [path, f] of this.files) entries.set(path, { mode: f.mode, type: f.type, sha: `sha:${path}`, size: f.content.length })
    return Promise.resolve({ treeSha: 'tree0', entries, truncated: this.truncated })
  }
  blob(_fork: string, sha: string): Promise<Buffer> {
    return Promise.resolve(this.files.get(sha.replace('sha:', ''))!.content)
  }
  async commit(fork: string, parent: string, baseTree: string, branch: string, files: { path: string; mode: string; content: string }[], message: string): Promise<string> {
    if (this.gate) await this.gate
    this.commits.push({ fork, parent, baseTree, branch, files, message })
    return String(this.commits.length).padStart(40, 'c')
  }
  moveGate: Promise<void> | null = null
  async moveBranch(_fork: string, branch: string, sha: string): Promise<void> {
    this.moves.push({ branch, sha })
    if (this.moveGate) await this.moveGate
  }
  pull(upstream: string, branch: string, title: string, body: string): Promise<PullOutcome> {
    this.pulls.push({ upstream, branch, title, body })
    return this.failWith ? Promise.reject(this.failWith) : Promise.resolve(this.pullOutcome)
  }
  patch = () => Promise.resolve(`diff --git a/x b/x\n+const t = "${TOKEN}"\n`)
}

let bot: FakeBot
let edits: RepoEdits
let warn: MockInstance<Logger['warn']>
const file = (content: string, mode = '100644', type = 'blob') => ({ mode, type, content: Buffer.from(content) })

beforeEach(() => {
  vi.restoreAllMocks()
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  bot = new FakeBot()
  bot.files.set('package.json', file('{\n  "name": "app",\n  "dependencies": {}\n}\n'))
  bot.files.set('start.sh', file('#!/bin/sh\nnode server.js\n', '100755'))
  bot.files.set('src/App.tsx', file(lines(100)))
  bot.files.set('link', file('target', '120000'))
  bot.files.set('src', file('', '040000', 'tree'))
  bot.files.set('logo.png', { mode: '100644', type: 'blob', content: Buffer.from([0xff, 0xfe, 0xfd, 0x00]) })
  bot.files.set('big.txt', file('x'.repeat(300 * 1024)))
  edits = new RepoEdits(bot as unknown as BotRepo)
})

const edit = (files: unknown, message: unknown = 'fix: import case', t = ticket()) => edits.edit(t, { files, message })
const put = (path: string, content: string) => ({ path, content })
const swap = (path: string, find: string, replace: string) => ({ path, find, replace })

describe('edit_repo_file arguments', () => {
  it.each([
    ['files not an array', 'x', 'INVALID_ARGUMENT'],
    ['no files', [], 'INVALID_ARGUMENT'],
    ['a file that is not an object', ['a'], 'INVALID_ARGUMENT'],
    ['a file with an extra key', [{ path: 'a', content: 'b', mode: 'x' }], 'INVALID_ARGUMENT'],
    ['content not a string', [{ path: 'a', content: 1 }], 'INVALID_ARGUMENT'],
    ['an empty find', [{ path: 'a', find: '', replace: 'x' }], 'INVALID_ARGUMENT'],
    ['find without replace', [{ path: 'a', find: 'x' }], 'INVALID_ARGUMENT'],
    ['both content and find', [{ path: 'a', content: 'x', find: 'y', replace: 'z' }], 'INVALID_ARGUMENT'],
    ['a NUL byte in replace', [{ path: 'a.txt', find: 'a', replace: 'a\0b' }], 'EDIT_FORBIDDEN'],
    ['an absolute path', [put('/etc/passwd', 'x')], 'INVALID_ARGUMENT'],
    ['a path that climbs out', [put('../x', 'x')], 'INVALID_ARGUMENT'],
    ['the root', [put('.', 'x')], 'INVALID_ARGUMENT'],
    ['a path listed twice', [put('a', 'x'), put('./a', 'y')], 'INVALID_ARGUMENT'],
    ['more than 5 files', Array.from({ length: 6 }, (_, i) => put(`f${i}`, 'x')), 'EDIT_FORBIDDEN'],
    ['.env', [put('.env', 'A=1')], 'EDIT_FORBIDDEN'],
    ['a nested .ENV', [put('be/.ENV', 'A=1')], 'EDIT_FORBIDDEN'],
    ['.env.production', [put('.env.production', 'A=1')], 'EDIT_FORBIDDEN'],
    ['.github/', [put('.github/workflows/ci.yml', 'on: push')], 'EDIT_FORBIDDEN'],
    ['.GitHub/ (case does not matter)', [put('.GitHub/x.yml', 'a')], 'EDIT_FORBIDDEN'],
    ['.git/', [put('sub/.git/config', 'a')], 'EDIT_FORBIDDEN'],
    ['a NUL byte (binary)', [put('a.txt', 'a\0b')], 'EDIT_FORBIDDEN'],
    ['content over 200KB', [put('a.txt', 'x'.repeat(201 * 1024))], 'EDIT_FORBIDDEN'],
  ])('refuses %s', async (_name, files, code) => {
    expect(await edit(files)).toMatchObject({ ok: false, code })
    expect(bot.commits).toEqual([])
  })

  it.each([[undefined], [''], ['  '], [1], ['x'.repeat(501)]])('refuses the message %j', async (message) => {
    // edit()는 message의 기본값이 있어 undefined를 그대로 보내려면 도구를 직접 부른다.
    expect(await edits.edit(ticket(), { files: [put('package.json', '{}')], message })).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' })
  })

  it('normalises the path and trims the message', () => {
    expect(checkEditArgs({ files: [put('./a//b.ts', 'x')], message: '  hi  ' })).toEqual({ files: [{ path: 'a/b.ts', content: 'x' }], message: 'hi' })
  })
})

describe('edit_repo_file', () => {
  it('commits the whole new content on the bot fork on top of the ticket commit and returns it as source', async () => {
    const answer = await edit([put('package.json', '{\n  "name": "app",\n  "dependencies": { "react": "^19" }\n}\n')])
    expect(answer).toEqual({ ok: true, content: { source: { commitSha: expect.stringMatching(/^c{39}1$/) as string }, files: ['package.json'], changedLines: 2 } })
    expect(bot.forks).toEqual(['student/app'])
    expect(bot.commits).toEqual([
      { fork: 'wanggane-bot/app', parent: BASE, baseTree: 'tree0', branch: 'wcp-edit-t_a', files: [{ path: 'package.json', mode: '100644', content: expect.stringContaining('react') as string }], message: 'fix: import case' },
    ])
  })

  it('keeps the executable bit of a changed file and writes a new file as a regular one', async () => {
    await edit([put('start.sh', '#!/bin/sh\nnode index.js\n'), put('Dockerfile', 'FROM node:22\n')])
    expect(bot.commits[0].files).toEqual([
      { path: 'start.sh', mode: '100755', content: '#!/bin/sh\nnode index.js\n' },
      { path: 'Dockerfile', mode: '100644', content: 'FROM node:22\n' },
    ])
  })

  it('builds on the earlier edits of the same ticket: files and changed lines add up, a rewritten file replaces its earlier content', async () => {
    await edit([put('package.json', '{}\n')])
    // package.json: 4 lines removed + 1 added (the second edit replaces the first one, it does not add to it), Dockerfile: 1 added.
    const second = await edit([put('Dockerfile', 'FROM node:22\n'), put('package.json', '{ "name": "x" }\n')])
    expect(second).toMatchObject({ ok: true, content: { files: ['package.json', 'Dockerfile'], changedLines: 6 } })
    expect(bot.commits[1].files.map((f) => f.path)).toEqual(['package.json', 'Dockerfile'])
    expect(bot.commits[1].files[0].content).toBe('{ "name": "x" }\n')
    // 두 commit 모두 티켓의 commit 위에 있다(앞 commit 위가 아니다): PR은 commit 하나다.
    expect(bot.commits.map((c) => c.parent)).toEqual([BASE, BASE])
    // fork는 한 번만 만든다.
    expect(bot.forks).toEqual(['student/app'])
  })

  it('drops a file that goes back to the original and refuses when nothing is left', async () => {
    const original = bot.files.get('package.json')!.content.toString()
    await edit([put('package.json', '{}\n')])
    expect(await edit([put('package.json', original)])).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT', message: expect.stringContaining('nothing to change') as string })
    expect(await edit([put('package.json', original), put('Dockerfile', 'FROM node:22\n')])).toMatchObject({ ok: true, content: { files: ['Dockerfile'] } })
  })

  it('refuses the same content as in the repository', async () => {
    expect(await edit([put('package.json', bot.files.get('package.json')!.content.toString())])).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' })
  })

  it('counts changed lines as added plus removed and allows exactly 50', async () => {
    // src/App.tsx has 100 lines. 25 changed lines = 25 removed + 25 added.
    const changed = (n: number) =>
      Array.from({ length: 100 }, (_, i) => (i < n ? `new ${i}` : `line ${i}`)).join('\n')
    expect(await edit([put('src/App.tsx', changed(25))])).toMatchObject({ ok: true, content: { changedLines: 50 } })
    expect(await edit([put('src/App.tsx', changed(26))])).toMatchObject({ ok: false, code: 'EDIT_FORBIDDEN', message: expect.stringContaining('50 changed lines') as string })
  })

  it('says how far a refused content is from the file and points to find/replace (a model that sent only the changed line)', async () => {
    const answer = await edit([put('src/App.tsx', 'line 0 fixed\n')])
    expect(answer).toMatchObject({ ok: false, code: 'EDIT_FORBIDDEN' })
    const message = (answer as { message: string }).message
    expect(message).toContain('src/App.tsx')
    expect(message).toContain('The file has 100 lines and the new content has 1')
    expect(message).toContain('0 already used')
    expect(message).toContain('{ path, find, replace }')
  })

  it('counts the lines over the whole ticket, not per call', async () => {
    await edit([put('src/App.tsx', lines(100).replace('line 1\n', 'a\n'))])
    const second = await edit([put('Dockerfile', lines(49, 'RUN'))])
    expect(second).toMatchObject({ ok: false, code: 'EDIT_FORBIDDEN' })
  })

  it('refuses a sixth file over the whole ticket', async () => {
    await edit([put('a', '1'), put('b', '1'), put('c', '1')])
    expect(await edit([put('d', '1'), put('e', '1')])).toMatchObject({ ok: true, content: { files: ['a', 'b', 'c', 'd', 'e'] } })
    expect(await edit([put('f', '1')])).toMatchObject({ ok: false, code: 'EDIT_FORBIDDEN', message: expect.stringContaining('6') as string })
  })

  it.each([
    ['a symbolic link', 'link'],
    ['a folder', 'src'],
    ['a binary file', 'logo.png'],
    ['a file over 200KB', 'big.txt'],
  ])('refuses to change %s', async (_name, path) => {
    expect(await edit([put(path, 'x\n')])).toMatchObject({ ok: false, code: 'EDIT_FORBIDDEN' })
    expect(bot.commits).toEqual([])
  })

  it('refuses a secret-looking value in an added line without repeating it, and in the commit message', async () => {
    const answer = await edit([put('src/config.ts', `export const token = '${TOKEN}'\n`)])
    expect(answer).toMatchObject({ ok: false, code: 'EDIT_FORBIDDEN' })
    expect(JSON.stringify(answer)).not.toContain(TOKEN)
    expect(await edit([put('a.txt', 'fine\n')], `use ${TOKEN}`)).toMatchObject({ ok: false, code: 'EDIT_FORBIDDEN' })
    expect(bot.commits).toEqual([])
  })

  it('lets a dependency named like a secret through (only the value shape counts) and ignores a secret in an unchanged line', async () => {
    bot.files.set('legacy.ts', file(`const old = '${TOKEN}'\nlet a = 1\n`))
    expect(await edit([put('package.json', '{\n  "name": "app",\n  "dependencies": { "jsonwebtoken": "^9.0.0" }\n}\n')])).toMatchObject({ ok: true })
    expect(await edit([put('legacy.ts', `const old = '${TOKEN}'\nlet a = 2\n`)])).toMatchObject({ ok: true })
  })

  it('does not guess whether a missing path is a new file when the file list was cut off', async () => {
    bot.truncated = true
    expect(await edit([put('src/deep/new.ts', 'x\n')])).toMatchObject({ ok: false, code: 'EDIT_FORBIDDEN', message: expect.stringContaining('too large') as string })
    // a file that is in the list is still fine
    expect(await edit([put('package.json', '{}\n')])).toMatchObject({ ok: true })
  })

  it('does not count a file that differs only by its final newline as changed', async () => {
    bot.files.set('a.txt', file('one\ntwo'))
    expect(await edit([put('a.txt', 'one\ntwo\n')])).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' })
    expect(await edit([put('a.txt', 'one\ntwo\n'), put('b.txt', 'x\n')])).toMatchObject({ ok: true, content: { files: ['b.txt'], changedLines: 1 } })
  })

  it('does not bring the record back when the ticket ended while the commit was being made', async () => {
    let release!: () => void
    bot.gate = new Promise((resolve) => (release = resolve))
    const running = edit([put('a', '1')])
    await Promise.resolve()
    await Promise.resolve()
    edits.forget('t_a')
    release()
    expect(await running).toMatchObject({ ok: false, message: expect.stringContaining('ended') as string })
    expect(edits.resolve(ticket(), { commitSha: '1'.padStart(40, 'c') })).toMatch(/not a commit/)
  })

  it('does not start a second edit while one is running', async () => {
    let release!: () => void
    bot.gate = new Promise((resolve) => (release = resolve))
    const first = edit([put('a', '1')])
    await Promise.resolve()
    expect(await edit([put('b', '1')])).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT', message: expect.stringContaining('still running') as string })
    release()
    expect(await first).toMatchObject({ ok: true })
  })

  it('keeps each ticket apart', async () => {
    await edit([put('a', '1')], 'm', ticket('t_a'))
    const other = await edit([put('b', '1')], 'm', ticket('t_b'))
    expect(other).toMatchObject({ ok: true, content: { files: ['b'] } })
    expect(bot.commits.map((c) => c.branch)).toEqual(['wcp-edit-t_a', 'wcp-edit-t_b'])
  })
})

describe('edit_repo_file find/replace', () => {
  it('replaces text that occurs once and counts only the changed lines', async () => {
    const answer = await edit([swap('src/App.tsx', 'line 42\n', 'line 42 fixed\n')])
    expect(answer).toMatchObject({ ok: true, content: { files: ['src/App.tsx'], changedLines: 2 } })
    expect(bot.commits[0].files[0].content).toBe(lines(100).replace('line 42\n', 'line 42 fixed\n'))
  })

  it('applies find to what this ticket already changed, and mixes with whole content in one call', async () => {
    await edit([swap('package.json', '"name": "app"', '"name": "web"')])
    const second = await edit([swap('package.json', '"web"', '"site"'), put('Dockerfile', 'FROM node:22\n')])
    expect(second).toMatchObject({ ok: true, content: { files: ['package.json', 'Dockerfile'] } })
    expect(bot.commits[1].files.find((f) => f.path === 'package.json')!.content).toBe('{\n  "name": "site",\n  "dependencies": {}\n}\n')
  })

  it('writes replace as it is, without $ patterns', async () => {
    await edit([swap('start.sh', 'server.js', '$& $1 $$.js')])
    expect(bot.commits[0].files[0]).toMatchObject({ mode: '100755', content: '#!/bin/sh\nnode $& $1 $$.js\n' })
  })

  it.each([
    ['find is not in the file', swap('start.sh', 'index.js', 'x'), 'not found'],
    ['find occurs twice', swap('src/App.tsx', 'line 1', 'x'), 'more than once'],
    ['the file does not exist', swap('src/new.ts', 'a', 'b'), 'does not exist'],
  ])('refuses when %s', async (_name, file, text) => {
    expect(await edit([file])).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT', message: expect.stringContaining(text) as string })
    expect(bot.commits).toEqual([])
  })

  it('refuses a replace that makes the file larger than 200KB', async () => {
    bot.files.set('mid.txt', file(`${'x'.repeat(199 * 1024)}\nMARK\n`))
    expect(await edit([swap('mid.txt', 'MARK', 'y'.repeat(2 * 1024))])).toMatchObject({ ok: false, code: 'EDIT_FORBIDDEN', message: expect.stringContaining('200KB') as string })
  })

  it('keeps the other checks: a secret in the replaced line, a binary file', async () => {
    expect(await edit([swap('start.sh', 'server.js', `server.js --token ${TOKEN}`)])).toMatchObject({ ok: false, code: 'EDIT_FORBIDDEN' })
    expect(await edit([swap('logo.png', 'a', 'b')])).toMatchObject({ ok: false, code: 'EDIT_FORBIDDEN' })
  })
})

describe('refusal log', () => {
  it('logs only the kind of an EDIT_FORBIDDEN refusal, never the path or the value', async () => {
    await edit([put('src/App.tsx', 'only one line\n')])
    await edit([put('.env', 'A=1')])
    await edit([put('src/config.ts', `export const token = '${TOKEN}'\n`)])
    expect(warn.mock.calls.map((c) => c[0] as string)).toEqual(['repo edit refused: lines', 'repo edit refused: path', 'repo edit refused: secret'])
  })
})

describe('the bot is not available', () => {
  it('answers BOT_UNAVAILABLE for both tools when there is no token and touches nothing', async () => {
    bot.token = false
    expect(await edit([put('a', '1')])).toMatchObject({ ok: false, code: 'BOT_UNAVAILABLE', message: expect.stringContaining('needs_user') as string })
    expect(await edits.openPr(ticket(), { source: { commitSha: BASE }, title: 't', body: 'b' }, () => true)).toMatchObject({ ok: false, code: 'BOT_UNAVAILABLE' })
    expect(bot.forks).toEqual([])
  })

  it.each([
    ['a repository that cannot be forked', new BotError('cannot-fork'), 'cannot fork'],
    ['GitHub failing', new BotError('github'), 'did not accept'],
    ['no token (it was dropped while running)', new BotError('none'), 'not configured'],
  ])('answers BOT_UNAVAILABLE for %s', async (_name, err, text) => {
    bot.failWith = err
    expect(await edit([put('a', '1')])).toMatchObject({ ok: false, code: 'BOT_UNAVAILABLE', message: expect.stringContaining(text) as string })
  })

  it('does not hide a bug that is not a bot error', async () => {
    bot.failWith = new TypeError('boom')
    await expect(edit([put('a', '1')])).rejects.toThrow('boom')
  })
})

describe('source', () => {
  const SOURCE = { commitSha: '1'.padStart(40, 'c') }

  it('accepts only a commit edit_repo_file returned in this ticket', async () => {
    expect(edits.resolve(ticket(), SOURCE)).toMatch(/not a commit that edit_repo_file returned/)
    await edit([put('a', '1')])
    expect(edits.resolve(ticket(), SOURCE)).toEqual({ repo: 'wanggane-bot/app', commitSha: SOURCE.commitSha })
    expect(edits.resolve(ticket('t_other'), SOURCE)).toMatch(/not a commit/)
  })

  it('remembers every commit it returned, not only the last one', async () => {
    await edit([put('a', '1')])
    await edit([put('b', '1')])
    expect(edits.resolve(ticket(), { commitSha: '1'.padStart(40, 'c') })).toMatchObject({ commitSha: expect.stringMatching(/c1$/) as string })
    expect(edits.resolve(ticket(), { commitSha: '2'.padStart(40, 'c') })).toMatchObject({ commitSha: expect.stringMatching(/c2$/) as string })
  })

  it.each([['a string', 'x'], ['null', null], ['no commitSha', {}], ['a short sha', { commitSha: 'abc' }], ['an extra key', { commitSha: BASE, repo: 'evil/x' }], ['an upper-case sha', { commitSha: BASE.toUpperCase() }]])(
    'refuses %s',
    (_name, source) => {
      expect(edits.resolve(ticket(), source)).toMatch(/source must be/)
    },
  )

  it('is gone when the ticket ends', async () => {
    await edit([put('a', '1')])
    edits.forget('t_a')
    expect(edits.resolve(ticket(), SOURCE)).toMatch(/not a commit/)
  })
})

describe('open_pr', () => {
  const SOURCE = { commitSha: '1'.padStart(40, 'c') }
  const open = (args: Record<string, unknown> = {}, verified: (source: SourceRef) => boolean = () => true, t = ticket()) => edits.openPr(t, { source: SOURCE, title: 'fix: 대소문자', body: '파일 이름을 맞췄습니다.', ...args }, verified)

  beforeEach(async () => {
    await edit([put('Dockerfile', 'FROM node:22\n')])
  })

  it('opens the pull request from the bot branch and returns its url', async () => {
    expect(await open()).toEqual({ ok: true, content: { url: 'https://github.com/student/app/pull/7' } })
    expect(bot.moves).toEqual([{ branch: 'wcp-fix-t_a', sha: SOURCE.commitSha }])
    expect(bot.pulls).toEqual([{ upstream: 'student/app', branch: 'wcp-fix-t_a', title: 'fix: 대소문자', body: '파일 이름을 맞췄습니다.' }])
    expect(edits.openedPr('t_a')).toEqual({ url: 'https://github.com/student/app/pull/7', files: ['Dockerfile'], changedLines: 1 })
  })

  it('needs the same source to have passed run_deploy and run_verify', async () => {
    expect(await open({}, () => false)).toMatchObject({ ok: false, code: 'NOT_VERIFIED' })
    expect(bot.pulls).toEqual([])
    expect(edits.openedPr('t_a')).toBeNull()
  })

  it('asks the check about the resolved source', async () => {
    const seen: unknown[] = []
    await open({}, (s) => (seen.push(s), true))
    expect(seen).toEqual([{ repo: 'wanggane-bot/app', commitSha: SOURCE.commitSha }])
  })

  it('refuses a source that edit_repo_file did not return, before any check', async () => {
    expect(await open({ source: { commitSha: BASE } })).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' })
    expect(await open({ source: undefined })).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' })
  })

  it.each([[{ title: '' }], [{ title: 5 }], [{ title: 'x'.repeat(201) }], [{ body: ' ' }], [{ body: 'x'.repeat(10_001) }]])('refuses %j', async (args) => {
    expect(await open(args)).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' })
  })

  it('does not open a pull request whose text has a secret-looking value', async () => {
    expect(await open({ body: `token ${TOKEN}` })).toMatchObject({ ok: false, code: 'EDIT_FORBIDDEN' })
    expect(bot.pulls).toEqual([])
  })

  it('is one pull request per ticket: the same source gets the same answer, another source is refused', async () => {
    await open()
    expect(await open()).toEqual({ ok: true, content: { url: 'https://github.com/student/app/pull/7' } })
    expect(bot.pulls).toHaveLength(1)
    await edits.edit(ticket(), { files: [put('b', '1')], message: 'm' }).catch(() => undefined)
    expect(await edits.edit(ticket(), { files: [put('c', '1')], message: 'm' })).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT', message: expect.stringContaining('already opened') as string })
  })

  it('keeps the patch (without a secret-looking value) for the platform when the student repository does not take the pull request', async () => {
    bot.pullOutcome = { opened: false }
    // 에이전트는 patch 글을 받지 않는다(모델이 옮겨 쓰다 잘리지 않게). 플랫폼이 needs_user 결과에 붙인다.
    expect(await open()).toEqual({ ok: true, content: { url: null, patchAttached: true } })
    expect(edits.patchFor('t_a')).toContain('diff --git')
    expect(edits.patchFor('t_a')).not.toContain(TOKEN)
    // 주소가 없으므로 pr_opened로 낼 수 없다.
    expect(edits.openedPr('t_a')).toBeNull()
  })

  it('has no patch when the pull request opened', async () => {
    await open()
    expect(edits.patchFor('t_a')).toBeNull()
  })

  it('moves only the pull request branch, never the branch the edits go to', async () => {
    await open()
    expect(bot.commits.map((c) => c.branch)).toEqual(['wcp-edit-t_a'])
    expect(bot.moves.map((m) => m.branch)).toEqual(['wcp-fix-t_a'])
  })

  it('does not open a pull request when the ticket ended while the branch was moving', async () => {
    let release = () => {}
    bot.moveGate = new Promise((r) => (release = r))
    const pending = open()
    await Promise.resolve()
    edits.forget('t_a')
    release()
    expect(await pending).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT', message: expect.stringContaining('ended') as string })
    expect(bot.pulls).toEqual([])
  })

  it('answers BOT_UNAVAILABLE when GitHub fails', async () => {
    bot.failWith = new BotError('github')
    expect(await open()).toMatchObject({ ok: false, code: 'BOT_UNAVAILABLE' })
    // 다시 부를 수 있다.
    bot.failWith = null
    expect(await open()).toMatchObject({ ok: true })
  })
})
