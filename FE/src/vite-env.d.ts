// vite/client는 tsconfig.app.json의 types가 불러온다. 여기서는 우리 변수의 타입만 좁힌다
// (선언하지 않으면 vite의 인덱스 시그니처 때문에 any가 되어 no-unsafe-* 규칙에 걸린다).
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  // 없거나 비어 있으면 상대 경로(/api/...)로 보낸다.
  readonly VITE_API_BASE_URL?: string
}
