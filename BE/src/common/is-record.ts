/** 배열이 아닌 객체인지 본다(null 제외). */
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
