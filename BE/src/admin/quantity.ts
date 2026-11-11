const UNITS: Record<string, number> = {
  n: 1e-9, u: 1e-6, m: 1e-3, '': 1, k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18,
  Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, Pi: 2 ** 50, Ei: 2 ** 60,
}
const QUANTITY = /^(\d+(?:\.\d+)?)(n|u|m|k|M|G|T|P|E|Ki|Mi|Gi|Ti|Pi|Ei)?$/

/** 쿠버네티스 수량 문자열(`3800m`, `16Gi`, `123456Ki`)을 기본 단위 수로. 알아볼 수 없으면 null. */
function quantity(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const m = QUANTITY.exec(value)
  return m ? Number(m[1]) * UNITS[m[2] ?? ''] : null
}

/** CPU 수량을 밀리코어 정수로. */
export const millicores = (value: unknown): number | null => {
  const q = quantity(value)
  return q === null ? null : Math.round(q * 1000)
}

/** 메모리 · 디스크 수량을 바이트 정수로. */
export const bytes = (value: unknown): number | null => {
  const q = quantity(value)
  return q === null ? null : Math.round(q)
}
