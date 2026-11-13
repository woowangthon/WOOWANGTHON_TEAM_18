// 탭 모양 한 벌. Tab(버튼)과 상단 바의 NavLink가 같이 쓴다. 활성 = 굵은 글씨 + accent-ui 밑줄.
export const tabClass = (active: boolean) =>
  `-mb-px border-0 border-b-2 px-3 text-base ${
    active
      ? 'border-accent-ui font-bold text-fg'
      : 'border-transparent text-muted hover:text-fg'
  }`
