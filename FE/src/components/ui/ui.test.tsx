import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { Alert } from './Alert.tsx'
import { Banner } from './Banner.tsx'
import { Badge } from './Badge.tsx'
import { Button } from './Button.tsx'
import { Field } from './Field.tsx'
import { Input } from './Input.tsx'
import { LogBlock } from './LogBlock.tsx'
import { Meter } from './Meter.tsx'
import { SelectField } from './Select.tsx'
import { Skeleton } from './Skeleton.tsx'
import { Spinner } from './Spinner.tsx'
import { Steps } from './Steps.tsx'
import { Tab, Tabs } from './Tabs.tsx'
import { Table, Td, Th, THead } from './Table.tsx'

const renderTable = () =>
  render(
    <Table aria-label="projects">
      <THead>
        <tr>
          <Th>name</Th>
          <Th numeric>pods</Th>
        </tr>
      </THead>
      <tbody>
        <tr>
          <Td>shop</Td>
          <Td numeric>2/3</Td>
        </tr>
      </tbody>
    </Table>,
  )

it('Button variants render with different styles and default to type=button', () => {
  render(
    <>
      <Button>primary</Button>
      <Button variant="outline">outline</Button>
    </>,
  )
  const primary = screen.getByRole('button', { name: 'primary' })
  const outline = screen.getByRole('button', { name: 'outline' })
  expect(primary.getAttribute('type')).toBe('button')
  expect(primary.className).toContain('bg-accent')
  expect(primary.className).toContain('text-accent-fg')
  // 기본 테두리가 있어야 비활성(disabled:border-line)이 되어도 너비가 변하지 않는다.
  expect(primary.className).toContain('border-transparent')
  expect(outline.className).toContain('border-line-strong')
  expect(outline.className).not.toContain('bg-accent')
})

it('Badge renders every variant with its own color', () => {
  const variants = ['neutral', 'ok', 'warn', 'err', 'info'] as const
  render(
    <>
      {variants.map((v) => (
        <Badge key={v} variant={v}>
          {v}
        </Badge>
      ))}
    </>,
  )
  const classes = variants.map((v) => screen.getByText(v).className)
  expect(new Set(classes).size).toBe(variants.length)
  expect(classes.every((c) => c.includes('whitespace-nowrap'))).toBe(true)
})

it('Input requires an accessible name, enforced by its type', () => {
  // @ts-expect-error neither aria-label nor aria-labelledby is given
  render(<Input />)
  render(<Input aria-label="repo" />)
  expect(screen.getByRole('textbox', { name: 'repo' })).toBeTruthy()
})

it('Input keeps its own classes and appends the caller className as a separate class', () => {
  render(<Input aria-label="repo" className="mt-2" />)
  const classes = screen.getByRole('textbox', { name: 'repo' }).className.split(' ')
  expect(classes).toContain('mt-2')
  expect(classes).toContain('disabled:text-muted')
})

it('Input draws its error border from aria-invalid, not from a caller class', () => {
  render(<Input aria-label="repo" />)
  expect(screen.getByRole('textbox', { name: 'repo' }).className).toContain(
    'aria-invalid:border-err',
  )
})

it('Field names its input with the visible label', () => {
  render(<Field label="이메일" type="email" />)
  const input = screen.getByRole('textbox', { name: '이메일' })
  expect(input.getAttribute('type')).toBe('email')
  // 라벨을 누르면 입력칸으로 가야 하므로 htmlFor도 맞아야 한다.
  expect(screen.getByText('이메일').getAttribute('for')).toBe(input.id)
  expect(input.getAttribute('aria-invalid')).toBeNull()
  expect(input.getAttribute('aria-describedby')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('Field with an error marks the input invalid and ties the message to it', () => {
  render(<Field label="이메일" error="올바른 이메일 형식이 아니에요" />)
  const input = screen.getByRole('textbox', { name: '이메일' })
  const message = screen.getByRole('alert')
  expect(message.textContent).toBe('올바른 이메일 형식이 아니에요')
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(input.getAttribute('aria-describedby')).toBe(message.id)
  expect(message.className).toContain('text-err')
})

it('Field gives each instance its own id and renders the trailing control after the input', () => {
  render(
    <>
      <Field label="이메일" />
      <Field label="비밀번호" trailing={<Button>보기</Button>} />
    </>,
  )
  const email = screen.getByRole('textbox', { name: '이메일' })
  const password = screen.getByRole('textbox', { name: '비밀번호' })
  expect(email.id).not.toBe(password.id)
  expect(screen.getByRole('button', { name: '보기' })).toBeTruthy()
})

it('Alert uses role=alert for errors and role=status for warnings and info, and always shows a title', () => {
  render(
    <>
      <Alert variant="err" title="로그인 실패" />
      <Alert variant="warn" title="잠시 쉬어요">
        1분 뒤에 다시 시도해 주세요
      </Alert>
      <Alert variant="info" title="인증이 필요해요" />
    </>,
  )
  expect(screen.getByRole('alert').textContent).toBe('로그인 실패')
  const warn = screen.getByText('잠시 쉬어요').parentElement
  expect(warn?.getAttribute('role')).toBe('status')
  expect(warn?.textContent).toContain('1분 뒤에 다시 시도해 주세요')
  expect(screen.getByText('인증이 필요해요').parentElement?.getAttribute('role')).toBe('status')
})

it('Alert variants differ in border and title color; the default variant is err', () => {
  render(
    <>
      <Alert title="e" />
      <Alert variant="warn" title="w" />
      <Alert variant="info" title="i" />
    </>,
  )
  expect(screen.getByRole('alert').className).toContain('border-err')
  expect(screen.getByText('w').parentElement?.className).toContain('border-warn')
  expect(screen.getByText('i').parentElement?.className).toContain('border-info')
  expect(screen.getByText('w').className).toContain('text-warn')
})

it('disabled Button and Input use tokens, not opacity (opacity fades the text with the background)', () => {
  render(
    <>
      <Button disabled>primary</Button>
      <Button variant="outline" disabled>
        outline
      </Button>
      <Input aria-label="repo" disabled />
    </>,
  )
  for (const el of [
    screen.getByRole('button', { name: 'primary' }),
    screen.getByRole('button', { name: 'outline' }),
    screen.getByRole('textbox', { name: 'repo' }),
  ]) {
    expect(el.className).toContain('disabled:text-muted')
    expect(el.className).not.toContain('disabled:opacity')
  }
})

it('Table is a named focusable region and scopes its headers', () => {
  renderTable()
  expect(screen.getByRole('region', { name: 'projects' }).getAttribute('tabindex')).toBe('0')
  expect(screen.getByText('pods').getAttribute('scope')).toBe('col')
})

it('Table cells do not wrap; only numeric cells are right-aligned in the mono font; headers are 13px', () => {
  renderTable()
  for (const text of ['name', 'pods', 'shop', '2/3']) {
    expect(screen.getByText(text).className).toContain('whitespace-nowrap')
  }
  expect(screen.getByText('2/3').className).toContain('text-right')
  expect(screen.getByText('2/3').className).toContain('font-mono')
  expect(screen.getByText('shop').className).not.toContain('font-mono')
  expect(screen.getByText('shop').className).not.toContain('text-right')
  // 한글은 12px에서 너무 가늘어 읽기 어려웠다.
  expect(screen.getByText('name').className).toContain('text-sm')
})

it('LogBlock is a named, focusable 13px region', () => {
  render(<LogBlock aria-label="logs">line</LogBlock>)
  const log = screen.getByRole('region', { name: 'logs' })
  expect(log.getAttribute('tabindex')).toBe('0')
  expect(log.className).toContain('text-sm')
})

it('LogBlock colors only the level words and keeps the text intact', () => {
  const text = '09:12 INFO pulled\n09:13 WARN 메모리 82%\n09:14 ERROR chat-서버 down'
  render(<LogBlock aria-label="logs">{text}</LogBlock>)
  expect(screen.getByText('INFO').className).toContain('text-muted')
  expect(screen.getByText('WARN').className).toContain('text-warn')
  expect(screen.getByText('ERROR').className).toContain('text-err')
  expect(screen.getByRole('region', { name: 'logs' }).textContent).toBe(text)
})

it('LogBlock colors level words in mixed string children and leaves elements untouched', () => {
  const ts = '09:12'
  render(
    <LogBlock aria-label="logs">
      {ts} ERROR pulled <b>WARN</b>
    </LogBlock>,
  )
  expect(screen.getByText('ERROR').className).toContain('text-err')
  expect(screen.getByText('WARN').tagName).toBe('B')
  expect(screen.getByText('WARN').className).not.toContain('text-warn')
  expect(screen.getByRole('region', { name: 'logs' }).textContent).toBe(
    '09:12 ERROR pulled WARN',
  )
})

it('SelectField names its select with the visible label and lists the options', () => {
  render(<SelectField label="역할" value="be" onChange={() => undefined} options={[{ value: '', label: '골라 주세요' }, { value: 'be', label: 'be' }]} />)
  const select = screen.getByRole<HTMLSelectElement>('combobox', { name: '역할' })
  expect(select.value).toBe('be')
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['골라 주세요', 'be'])
  expect(select.getAttribute('aria-invalid')).toBeNull()
})

it('SelectField with an error marks the select invalid and ties the message to it', () => {
  render(<SelectField label="역할" value="" onChange={() => undefined} options={[{ value: '', label: '골라 주세요' }]} error="입력해 주세요" />)
  const select = screen.getByRole('combobox', { name: '역할' })
  expect(select.getAttribute('aria-invalid')).toBe('true')
  const message = screen.getByRole('alert')
  expect(select.getAttribute('aria-describedby')).toBe(message.id)
  expect(message.textContent).toBe('입력해 주세요')
})

it('Field and SelectField tie the hint to the control, after the error id when both exist', () => {
  render(
    <>
      <Field label="이름" hint="소문자로 시작" error="입력해 주세요" />
      <SelectField label="역할" value="" onChange={() => undefined} options={[{ value: '', label: '골라 주세요' }]} hint="하나만 고를 수 있어요" />
    </>,
  )
  const input = screen.getByRole('textbox', { name: '이름' })
  const [errorId, hintId] = (input.getAttribute('aria-describedby') ?? '').split(' ')
  expect(document.getElementById(errorId ?? '')?.textContent).toBe('입력해 주세요')
  expect(document.getElementById(hintId ?? '')?.textContent).toBe('소문자로 시작')
  const select = screen.getByRole('combobox', { name: '역할' })
  expect(document.getElementById(select.getAttribute('aria-describedby') ?? '')?.textContent).toBe('하나만 고를 수 있어요')
})

it('SelectField passes the chosen value, not the event', () => {
  const seen: string[] = []
  render(<SelectField label="역할" value="" onChange={(value) => seen.push(value)} options={[{ value: '', label: '골라 주세요' }, { value: 'be', label: 'be' }]} />)
  fireEvent.change(screen.getByRole('combobox', { name: '역할' }), { target: { value: 'be' } })
  expect(seen).toEqual(['be'])
})

it('Tabs are a tablist: the active tab is selected and the only one in the Tab order, arrows move focus', () => {
  render(
    <Tabs aria-label="보기">
      <Tab active>개요</Tab>
      <Tab>배포 이력</Tab>
      <Tab>로그</Tab>
    </Tabs>,
  )
  expect(screen.getByRole('tablist', { name: '보기' })).toBeTruthy()
  const [on, mid, last] = screen.getAllByRole('tab')
  expect(on.getAttribute('aria-selected')).toBe('true')
  expect(on.className).toContain('border-accent-ui')
  expect(on.className).toContain('font-bold')
  expect(on.getAttribute('tabindex')).toBe('0')
  expect(mid.getAttribute('aria-selected')).toBe('false')
  expect(mid.getAttribute('tabindex')).toBe('-1')
  on.focus()
  fireEvent.keyDown(on, { key: 'ArrowRight' })
  expect(document.activeElement).toBe(mid)
  fireEvent.keyDown(mid, { key: 'End' })
  expect(document.activeElement).toBe(last)
  fireEvent.keyDown(last, { key: 'ArrowRight' })
  expect(document.activeElement).toBe(on)
  fireEvent.keyDown(on, { key: 'ArrowLeft' })
  expect(document.activeElement).toBe(last)
  // Alt+← 같은 브라우저 단축키는 탭 이동으로 가로채지 않는다.
  fireEvent.keyDown(last, { key: 'ArrowLeft', altKey: true })
  expect(document.activeElement).toBe(last)
})

it('Spinner is a named status', () => {
  render(<Spinner label="처리 중" />)
  expect(screen.getByRole('status', { name: '처리 중' }).className).toContain('spinner')
})

it('Skeleton is hidden from assistive tech', () => {
  const { container } = render(<Skeleton block />)
  expect((container.firstElementChild as HTMLElement).getAttribute('aria-hidden')).toBe('true')
})

it('Banner reads errors at once (alert) and the rest politely (status), with a mark besides color', () => {
  render(
    <>
      <Banner variant="err">빌드가 실패했어요</Banner>
      <Banner variant="ok">배포가 끝났어요</Banner>
      <Banner>승인을 기다려요</Banner>
    </>,
  )
  expect(screen.getByRole('alert').textContent).toContain('빌드가 실패했어요')
  expect(screen.getAllByRole('status')).toHaveLength(2)
  expect(screen.getByRole('alert').querySelector('svg')).toBeTruthy()
  expect(screen.getByText('배포가 끝났어요').parentElement?.parentElement?.querySelector('svg')).toBeTruthy()
})

it('Steps list every step with its state in text and mark the running one as the current step', () => {
  render(
    <Steps
      aria-label="배포 단계"
      steps={[
        { label: '접수', state: 'done' },
        { label: '빌드', state: 'run' },
        { label: '배포', state: 'pend', note: '대기 중' },
      ]}
    />,
  )
  const items = screen.getAllByRole('listitem')
  expect(items).toHaveLength(3)
  expect(items[0].textContent).toContain('완료')
  expect(items[1].textContent).toContain('진행 중')
  // 진행 중 · 대기 · 실패는 상태 글자가 눈에 보인다(색이 가까워 색만으로는 못 가른다).
  expect(screen.getByText('진행 중').className).not.toContain('sr-only')
  expect(items[1].getAttribute('aria-current')).toBe('step')
  expect(items[2].textContent).toContain('대기 중')
  expect(items[0].getAttribute('aria-current')).toBeNull()
})

it('Steps show waiting and failed states in text and by shape, not by color alone', () => {
  render(
    <Steps
      aria-label="배포 단계"
      steps={[
        { label: '비밀값', state: 'wait' },
        { label: '빌드', state: 'fail' },
      ]}
    />,
  )
  const [wait, fail] = screen.getAllByRole('listitem')
  expect(wait.textContent).toContain('입력 대기')
  expect(wait.querySelector('.border-dashed')).toBeTruthy()
  expect(fail.textContent).toContain('실패')
  expect(fail.querySelector('svg')).toBeTruthy()
})

it('Meter exposes its value and clamps the bar to 0–100%', () => {
  const { rerender } = render(<Meter value={60} aria-label="사용량" />)
  const m = screen.getByRole('progressbar', { name: '사용량' })
  expect(m.getAttribute('aria-valuenow')).toBe('60')
  expect((m.firstElementChild as HTMLElement).style.width).toBe('60%')
  rerender(<Meter value={250} max={100} aria-label="사용량" />)
  expect((screen.getByRole('progressbar').firstElementChild as HTMLElement).style.width).toBe('100%')
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
  rerender(<Meter value={-5} aria-label="사용량" />)
  expect((screen.getByRole('progressbar').firstElementChild as HTMLElement).style.width).toBe('0%')
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0')
})
