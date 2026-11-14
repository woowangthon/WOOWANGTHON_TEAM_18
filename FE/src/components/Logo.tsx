// 서비스 로고. 로고가 흰 배경이라 다크에서는 밝은 칩 위에 올린다(투명 배경 로고가 생기면 칩을 뺀다). 이름은 곁 글자가 없을 때만 읽힌다.
function Logo({ className = 'size-10' }: { className?: string }) {
  return <img src="/logo.svg" alt="WCP" className={`rounded-md object-contain dark:bg-fg dark:p-0.5 ${className}`} />
}

export default Logo
