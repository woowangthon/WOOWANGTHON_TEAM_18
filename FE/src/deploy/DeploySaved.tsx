import type { ReactNode } from 'react'
import { Alert } from '../components/ui/Alert.tsx'
import { Badge } from '../components/ui/Badge.tsx'
import { Table, Td, Th, THead } from '../components/ui/Table.tsx'
import CommitRef from './CommitRef.tsx'
import type { SavedDeploy } from './types.ts'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4">
      <dt className="w-28 text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

// 저장한 배포 입력(201)을 보여 준다. 저장한 뒤에는 바뀌지 않는다. 고치려면 새로 저장한다.
function DeploySaved({ saved }: { saved: SavedDeploy }) {
  const secrets = saved.spec.services.flatMap((s) => s.runtime.secretKeys.map((key) => `${s.name}: ${key}`))
  return (
    <section aria-labelledby="saved-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="saved-heading" className="text-lg">
          배포 설정을 저장했어요
        </h2>
        <Badge variant="ok">저장됨</Badge>
      </div>
      <dl className="flex flex-col gap-1 text-sm">
        <Row label="배포 ID">
          <span className="font-mono">{saved.id}</span>
        </Row>
        <Row label="레포">
          <span className="font-mono">{saved.repo}</span>
        </Row>
        <Row label="commit">
          <CommitRef commit={saved.commit} />
        </Row>
        <Row label="프로젝트 이름">
          <span className="font-mono">{saved.spec.project.slug}</span>
        </Row>
      </dl>
      <Table aria-label="저장한 서비스 목록">
        <THead>
          <tr>
            <Th>이름</Th>
            <Th>역할</Th>
            <Th>빌드</Th>
            <Th>실행</Th>
            <Th>공개 경로</Th>
          </tr>
        </THead>
        <tbody>
          {saved.spec.services.map((s) => (
            <tr key={s.name}>
              <Td className="font-mono">{s.name}</Td>
              <Td>{s.role}</Td>
              <Td className="font-mono">{s.build.dockerfile ?? s.build.framework ?? '-'}</Td>
              <Td>{s.runtime.kind === 'static' ? '정적' : `서버 :${s.runtime.port}`}</Td>
              <Td className="font-mono">{s.runtime.ingressPath ?? '내부 전용'}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {secrets.length > 0 && (
        <Alert variant="info" title="비밀값을 넣을 차례가 남았어요">
          <p>저장한 것은 이름뿐이에요. 값은 다음 단계에서 넣어요.</p>
          <ul className="mt-1 font-mono">
            {secrets.map((secret) => (
              <li key={secret}>{secret}</li>
            ))}
          </ul>
        </Alert>
      )}
    </section>
  )
}

export default DeploySaved
