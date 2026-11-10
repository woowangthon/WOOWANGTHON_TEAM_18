import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '../components/ui/Button.tsx'
import { Card } from '../components/ui/Card.tsx'
import { Field } from '../components/ui/Field.tsx'
import { Input } from '../components/ui/Input.tsx'
import { SelectField } from '../components/ui/Select.tsx'
import { FRAMEWORKS, HEALTH_TYPES, MAX_SERVICES, NAME_MAX, ROLES, SLUG_MAX, STATIC_PORT, TIMEOUT_MAX, TIMEOUT_MIN } from './limits.ts'
import { blankService, serviceFromProject, withRole } from './spec-form.ts'
import type { EnvRow, Hint, LinkRow, ServiceForm, SpecForm } from './spec-form.ts'
import type { DraftProject } from './types.ts'

const SOURCE_LABEL: Record<string, string> = { 'package.json': 'package.json', lockfile: '락 파일', default: '기본값' }

// 칸 옆에 보일 출처. 자동으로 정하지 못한 칸은 사용자가 골라야 한다고 알린다.
function hintText(hint: Hint | undefined): string | undefined {
  if (!hint) return undefined
  if (hint.review) {
    const candidates = hint.candidates?.length ? ` (후보: ${hint.candidates.join(', ')})` : ''
    return `자동으로 정하지 못했어요. 골라 주세요${candidates}`
  }
  return hint.source ? `출처: ${SOURCE_LABEL[hint.source] ?? hint.source}` : undefined
}

type TextProps = {
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  hint?: string
  disabled?: boolean
  placeholder?: string
  mono?: boolean
}

function Text({ label, value, onChange, error, hint, disabled, placeholder, mono }: TextProps) {
  return (
    <Field
      label={label}
      value={value}
      onChange={(event) => {
        onChange(event.target.value)
      }}
      error={error}
      hint={hint}
      disabled={disabled}
      placeholder={placeholder}
      className={mono ? 'font-mono' : undefined}
    />
  )
}

type RowsProps<T> = {
  legend: string
  addLabel: string
  rows: T[]
  blank: T
  onChange: (rows: T[]) => void
  disabled?: boolean
  error?: string
  hint?: string
  children: (row: T, index: number, set: (next: T) => void) => ReactNode
}

// 줄을 더하고 지우는 목록. env · secretKeys · links가 같은 모양을 쓴다.
function Rows<T>({ legend, addLabel, rows, blank, onChange, disabled, error, hint, children }: RowsProps<T>) {
  return (
    <fieldset className="flex flex-col gap-2 sm:col-span-2" disabled={disabled}>
      <legend className="text-sm font-bold">{legend}</legend>
      {hint && <p className="text-xs text-muted">{hint}</p>}
      {rows.map((row, index) => (
        // 줄에는 고정된 id가 없어 위치를 key로 쓴다. 입력값은 모두 props로 오므로 줄을 지워도 어긋나지 않는다.
        <div key={index} className="flex flex-wrap items-start gap-2">
          {children(row, index, (next) => {
            onChange(rows.map((r, i) => (i === index ? next : r)))
          })}
          <Button
            variant="outline"
            aria-label={`${legend} ${index + 1} 삭제`}
            onClick={() => {
              onChange(rows.filter((_, i) => i !== index))
            }}
          >
            삭제
          </Button>
        </div>
      ))}
      {error && (
        <span role="alert" className="text-sm text-err">
          {error}
        </span>
      )}
      <div>
        <Button
          variant="outline"
          onClick={() => {
            onChange([...rows, blank])
          }}
        >
          {addLabel}
        </Button>
      </div>
    </fieldset>
  )
}

// 줄 안의 입력칸. 보이는 라벨 대신 줄 번호가 들어간 이름을 준다.
function RowInput({ label, value, onChange, error, mono }: { label: string; value: string; onChange: (v: string) => void; error?: string; mono?: boolean }) {
  return (
    <div className="flex min-w-40 flex-1 flex-col gap-1">
      <Input
        aria-label={label}
        value={value}
        aria-invalid={error ? true : undefined}
        className={mono ? 'font-mono' : undefined}
        onChange={(event) => {
          onChange(event.target.value)
        }}
      />
      {error && (
        <span role="alert" className="text-sm text-err">
          {error}
        </span>
      )}
    </div>
  )
}

const pick = (value: string, label: string) => ({ value, label })
const ROLE_OPTIONS = [pick('', '골라 주세요'), ...ROLES.map((r) => pick(r, r))]
const FRAMEWORK_OPTIONS = [pick('', '골라 주세요'), ...FRAMEWORKS.map((f) => pick(f, f))]
const KIND_OPTIONS = [pick('server', '서버 (계속 실행)'), pick('static', '정적 사이트 (빌드 결과를 서빙)')]
const HEALTH_OPTIONS = HEALTH_TYPES.map((t) => pick(t, t))

type EnvRowsProps = { legend: string; rows: EnvRow[]; path: string; issues: Map<string, string>; disabled: boolean; hint?: string; onChange: (rows: EnvRow[]) => void }

function EnvRows({ legend, rows, path, issues, disabled, hint, onChange }: EnvRowsProps) {
  return (
    <Rows legend={legend} addLabel={`${legend} 추가`} rows={rows} blank={{ name: '', value: '' }} onChange={onChange} disabled={disabled} hint={hint} error={issues.get(path)}>
      {(row, index, set) => (
        <>
          <RowInput label={`${legend} 이름 ${index + 1}`} value={row.name} mono error={issues.get(`${path}.${row.name.trim()}`)} onChange={(name) => { set({ ...row, name }) }} />
          <RowInput label={`${legend} 값 ${index + 1}`} value={row.value} mono onChange={(value) => { set({ ...row, value }) }} />
        </>
      )}
    </Rows>
  )
}

// 포트 칸 아래 안내. 정적은 8080 고정이라 Dockerfile로 빌드하는 컨테이너도 8080에서 서빙해야 한다.
function portHint(s: ServiceForm, isStatic: boolean, hasDockerfile: boolean): string | undefined {
  if (isStatic) {
    return hasDockerfile ? `정적 사이트는 ${STATIC_PORT} 고정이에요. Dockerfile로 빌드한 컨테이너가 ${STATIC_PORT}에서 서빙해야 해요.` : `정적 사이트는 ${STATIC_PORT} 고정`
  }
  return hintText(s.hints.port) ?? (hasDockerfile ? 'Dockerfile의 컨테이너가 받는 포트(EXPOSE)를 적어 주세요' : undefined)
}

type ServiceProps = {
  service: ServiceForm
  index: number
  names: string[]
  dockerfiles: string[]
  issues: Map<string, string>
  disabled: boolean
  onChange: (next: ServiceForm) => void
  onRemove: () => void
}

function ServiceFields({ service: s, index, names, dockerfiles, issues, disabled, onChange, onRemove }: ServiceProps) {
  const at = `services[${index}]`
  const err = (path: string) => issues.get(`${at}.${path}`)
  const set = (patch: Partial<ServiceForm>) => {
    onChange({ ...s, ...patch })
  }
  const isStatic = s.kind === 'static'
  const hasDockerfile = s.dockerfile !== ''
  const dockerfileOptions = [pick('', 'Dockerfile 없음 (아래 설정으로 빌드)'), ...dockerfiles.map((d) => pick(d, d))]
  // 연결할 수 있는 서비스는 다른 서비스다. 이름을 아직 안 적은 서비스는 고를 수 없다.
  const linkOptions = [pick('', '골라 주세요'), ...names.filter((n, i) => n !== '' && i !== index).map((n) => pick(n, n))]

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg">서비스 {index + 1}</h3>
        <Button variant="outline" onClick={onRemove} disabled={disabled} aria-label={`서비스 ${index + 1} 빼기`}>
          빼기
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Text label="이름" value={s.name} onChange={(name) => { set({ name }) }} error={err('name')} disabled={disabled} hint={`소문자로 시작, 최대 ${NAME_MAX}자. 클러스터 안의 이름이 돼요.`} />
        <SelectField label="역할" value={s.role} options={ROLE_OPTIONS} onChange={(role) => { onChange(withRole(s, role)) }} error={err('role')} disabled={disabled} />
        <Text label="폴더" value={s.dir} onChange={(dir) => { set({ dir }) }} error={err('dir')} disabled={disabled} mono hint="레포 안의 위치. 루트는 ." />

        <SelectField label="Dockerfile" value={s.dockerfile} options={dockerfileOptions} onChange={(dockerfile) => { set({ dockerfile }) }} error={err('build.dockerfile')} disabled={disabled} />
        <Text label="빌드 위치" value={s.context} onChange={(context) => { set({ context }) }} error={err('build.context')} disabled={disabled} mono hint="빌드를 시작할 레포 안의 폴더" />
        {hasDockerfile ? (
          <p className="text-sm text-muted sm:col-span-2">Dockerfile로 빌드하므로 프레임워크 · 설치 · 빌드 · 시작 칸은 쓰지 않아요.</p>
        ) : (
          <>
            <SelectField label="프레임워크" value={s.framework} options={FRAMEWORK_OPTIONS} onChange={(framework) => { set({ framework }) }} error={err('build.framework')} hint={hintText(s.hints.framework)} disabled={disabled} />
            <Text label="Node 버전" value={s.nodeVersion} onChange={(nodeVersion) => { set({ nodeVersion }) }} error={err('build.nodeVersion')} disabled={disabled} mono placeholder="22" hint={s.nodeVersionRaw ? `package.json의 engines.node: ${s.nodeVersionRaw}. 22 · 22.1 · 22.1.0 모양으로 적어 주세요.` : '22 · 22.1 · 22.1.0 모양으로 적어 주세요.'} />
            <Text label="설치 명령" value={s.install} onChange={(install) => { set({ install }) }} error={err('build.install')} disabled={disabled} mono hint={hintText(s.hints.install)} />
            <Text label="빌드 명령" value={s.build} onChange={(build) => { set({ build }) }} error={err('build.build')} disabled={disabled} mono hint={hintText(s.hints.build)} />
            {isStatic ? (
              <Text label="출력 폴더" value={s.outputDir} onChange={(outputDir) => { set({ outputDir }) }} error={err('build.outputDir')} disabled={disabled} mono hint={hintText(s.hints.outputDir)} />
            ) : (
              <Text label="시작 명령" value={s.start} onChange={(start) => { set({ start }) }} error={err('build.start')} disabled={disabled} mono hint={hintText(s.hints.start)} />
            )}
          </>
        )}

        <SelectField
          label="실행 방식"
          value={s.kind}
          options={KIND_OPTIONS}
          onChange={(kind) => {
            set({ kind: kind === 'static' ? 'static' : 'server' })
          }}
          error={err('runtime.kind')}
          disabled={disabled}
        />
        <Text label="포트" value={isStatic ? String(STATIC_PORT) : s.port} onChange={(port) => { set({ port }) }} error={err('runtime.port')} disabled={disabled || isStatic} mono hint={portHint(s, isStatic, hasDockerfile)} />
        <SelectField label="상태 확인 방식" value={s.healthType} options={HEALTH_OPTIONS} onChange={(type) => { set({ healthType: type === 'tcp' ? 'tcp' : 'http' }) }} error={err('runtime.health.type')} disabled={disabled} />
        {s.healthType === 'http' && <Text label="상태 확인 경로" value={s.healthPath} onChange={(healthPath) => { set({ healthPath }) }} error={err('runtime.health.path')} disabled={disabled} mono />}
        <Text label="시작 대기 시간(초)" value={s.timeout} onChange={(timeout) => { set({ timeout }) }} error={err('runtime.health.startupTimeoutSeconds')} disabled={disabled} mono hint={`${TIMEOUT_MIN}~${TIMEOUT_MAX}초`} />
        <Text label="공개 경로" value={s.ingressPath} onChange={(ingressPath) => { set({ ingressPath }) }} error={err('runtime.ingressPath')} disabled={disabled} mono placeholder="/" hint="비우면 밖에서 접근할 수 없는 내부 전용이에요. 서비스끼리 겹칠 수 없어요." />
        <p className="text-xs text-muted sm:col-span-2">경로 접두사 제거(stripPrefix)는 아직 지원하지 않아요.</p>

        <EnvRows legend="빌드 환경변수" rows={s.buildEnv} path={`${at}.build.buildEnv`} issues={issues} disabled={disabled} hint="빌드 결과에 들어가는 공개 값이에요. 비밀값은 넣지 마세요." onChange={(buildEnv) => { set({ buildEnv }) }} />
        {!isStatic && (
          <>
            <EnvRows legend="환경변수" rows={s.env} path={`${at}.runtime.env`} issues={issues} disabled={disabled} hint="공개 값만 적어요. 비밀값은 아래에 이름만 적고, 값은 다음 단계에서 넣어요." onChange={(env) => { set({ env }) }} />
            <Rows legend="비밀값 이름" addLabel="비밀값 이름 추가" rows={s.secretKeys} blank="" onChange={(secretKeys) => { set({ secretKeys }) }} disabled={disabled} error={issues.get(`${at}.runtime.secretKeys`)}>
              {(row, i, setRow) => <RowInput label={`비밀값 이름 ${i + 1}`} value={row} mono error={issues.get(`${at}.runtime.secretKeys[${i}]`)} onChange={setRow} />}
            </Rows>
            <Rows<LinkRow> legend="다른 서비스 연결" addLabel="연결 추가" rows={s.links} blank={{ env: '', service: '' }} onChange={(links) => { set({ links }) }} disabled={disabled} error={issues.get(`${at}.runtime.links`)} hint="다른 서비스의 주소를 이 환경변수로 받아요.">
              {(row, i, setRow) => (
                <>
                  <RowInput label={`연결 환경변수 이름 ${i + 1}`} value={row.env} mono error={issues.get(`${at}.runtime.links[${i}].env`)} onChange={(env) => { setRow({ ...row, env }) }} />
                  <SelectField label={`연결할 서비스 ${i + 1}`} value={row.service} options={linkOptions} error={issues.get(`${at}.runtime.links[${i}].service`)} onChange={(service) => { setRow({ ...row, service }) }} />
                </>
              )}
            </Rows>
          </>
        )}
      </div>
    </Card>
  )
}

type Props = {
  form: SpecForm
  projects: DraftProject[]
  dockerfiles: string[]
  issues: Map<string, string>
  disabled: boolean
  onChange: (form: SpecForm) => void
}

// 초안으로 미리 채운 배포 설정 편집 폼. 값 변환과 검사는 spec-form.ts가 한다.
function SpecFormFields({ form, projects, dockerfiles, issues, disabled, onChange }: Props) {
  const unused = projects.filter((p) => !form.services.some((s) => s.dir === p.dir))
  // 추가할 폴더를 고르는 select의 값. 비어 있으면 빈 서비스를 더한다.
  const [addDir, setAddDir] = useState('')
  const names = form.services.map((s) => s.name.trim())

  function addService() {
    const project = unused.find((p) => p.dir === addDir)
    const next = project ? serviceFromProject(project, dockerfiles) : blankService()
    onChange({ ...form, services: [...form.services, next] })
    setAddDir('')
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Text label="프로젝트 이름(slug)" value={form.slug} onChange={(slug) => { onChange({ ...form, slug }) }} error={issues.get('project.slug')} disabled={disabled} mono hint={`소문자 · 숫자 · 하이픈, 최대 ${SLUG_MAX}자. 공개 주소와 클러스터 이름이 돼요.`} />
        <div className="flex flex-col gap-1">
          <span className="text-sm font-bold">레포</span>
          <p className="flex h-8 items-center font-mono text-sm">{form.repo}</p>
          <p className="text-xs text-muted">확인한 레포라 고칠 수 없어요.</p>
        </div>
      </div>

      {form.services.map((service, index) => (
        <section key={service.id} aria-label={`서비스 ${index + 1}`}>
          <ServiceFields
            service={service}
            index={index}
            names={names}
            dockerfiles={dockerfiles}
            issues={issues}
            disabled={disabled}
            onChange={(next) => {
              onChange({ ...form, services: form.services.map((s, i) => (i === index ? next : s)) })
            }}
            onRemove={() => {
              onChange({ ...form, services: form.services.filter((_, i) => i !== index) })
            }}
          />
        </section>
      ))}

      {form.services.length < MAX_SERVICES ? (
        <div className="flex flex-wrap items-end gap-2">
          {unused.length > 0 && (
            <SelectField
              label="추가할 폴더"
              value={addDir}
              options={[pick('', '직접 입력'), ...unused.map((p) => pick(p.dir, p.dir))]}
              onChange={setAddDir}
              disabled={disabled}
            />
          )}
          <Button variant="outline" onClick={addService} disabled={disabled}>
            서비스 추가
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">서비스는 최대 {MAX_SERVICES}개까지 둘 수 있어요.</p>
      )}
    </div>
  )
}

export default SpecFormFields
