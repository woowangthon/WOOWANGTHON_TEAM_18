import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { Badge } from './Badge.tsx'
import { Button } from './Button.tsx'
import { Input } from './Input.tsx'
import { LogBlock } from './LogBlock.tsx'
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
  expect(primary.className).toContain('bg-fg')
  // 기본 테두리가 있어야 비활성(disabled:border-line)이 되어도 너비가 변하지 않는다.
  expect(primary.className).toContain('border-transparent')
  expect(outline.className).toContain('border-line-strong')
  expect(outline.className).not.toContain('bg-fg')
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
