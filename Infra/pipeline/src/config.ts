// 실행기 env에서 읽는 설정. 값이 틀리면 CodeBuild · k3s API를 부르기 전에 멈춘다. 비밀값(키 · 토큰)은 여기에 없다.

export function required(env: NodeJS.ProcessEnv, name: string, pattern: RegExp, example: string): string {
  const value = env[name]
  if (value === undefined || !pattern.test(value)) throw new Error(`${name} must look like ${example}`)
  return value
}
