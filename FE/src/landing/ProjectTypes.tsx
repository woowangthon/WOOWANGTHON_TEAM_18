import { Card } from '../components/ui/Card.tsx'

// 서비스 유형 설명. 처음 배포하는 학생이 "정적 웹"이 무엇인지 몰라도 고를 수 있게 일상의 말로 적는다.
const TYPES = [
  {
    name: '정적 웹',
    what: 'HTML · CSS · JS 파일만 있는 화면이에요. 서버 없이 브라우저가 그대로 보여 줘요.',
    examples: '포트폴리오, 소개 페이지',
    get: '웹 주소',
  },
  {
    name: '서버',
    what: '요청을 받아 데이터를 처리하고 답을 돌려주는 프로그램(API)이에요.',
    examples: '로그인, 게시판 API',
    get: 'API 주소',
  },
  {
    name: '웹 + 서버',
    what: '화면과 서버가 한 레포에 같이 들어 있는 프로젝트예요.',
    examples: '동아리 홈페이지 + API',
    get: '웹 주소와 API 경로',
  },
]

function ProjectTypes() {
  return (
    <section id="types" className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-300 flex-col gap-8 px-3 py-16 sm:px-4">
        <div className="flex max-w-2xl flex-col gap-3">
          <h2 className="text-2xl">어떤 프로젝트를 올릴 수 있나요</h2>
          <p className="text-lg text-muted">서비스 유형은 레포를 제출할 때 직접 골라요. 잘 모르겠으면 아래 설명을 보고 고르면 돼요.</p>
        </div>
        <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
          {TYPES.map((t) => (
            <li key={t.name}>
              <Card className="flex h-full flex-col gap-3 p-6">
                <h3 className="text-xl">{t.name}</h3>
                <p>{t.what}</p>
                <dl className="m-0 mt-auto flex flex-col gap-1 text-sm">
                  <div className="flex gap-2">
                    <dt className="text-muted">예를 들면</dt>
                    <dd className="m-0">{t.examples}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-muted">받는 것</dt>
                    <dd className="m-0 font-bold">{t.get}</dd>
                  </div>
                </dl>
              </Card>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-3">
          <h3 className="text-xl">어떤 언어로 만들었든</h3>
          <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
            <li className="flex flex-col gap-1">
              <p className="font-bold">Dockerfile이 있으면</p>
              <p className="text-sm text-muted">컨테이너로 빌드되는 언어라면 올릴 수 있어요. 예를 들면 Node.js, Python, Java, Go가 있어요. 시험해 본 목록은 아니에요.</p>
            </li>
            <li className="flex flex-col gap-1">
              <p className="font-bold">Dockerfile이 없으면</p>
              <p className="text-sm text-muted">플랫폼의 기본 Dockerfile로 React(Vite)와 Next.js를 올릴 수 있어요. 다른 언어는 Dockerfile을 직접 넣어 주세요.</p>
            </li>
            <li className="flex flex-col gap-1">
              <p className="font-bold">데이터베이스는</p>
              <p className="text-sm text-muted">없어도 되고, 직접 마련한 데이터베이스를 쓰려면 연결 정보를 비밀값으로 넣어요.</p>
            </li>
          </ul>
        </div>
      </div>
    </section>
  )
}

export default ProjectTypes
