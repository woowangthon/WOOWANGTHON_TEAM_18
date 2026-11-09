import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// 값이 없는데 조용히 넘어가면 로그인이 이유 없이 실패한다. 어떤 변수가 비었는지 바로 알린다.
if (!url) {
  throw new Error('VITE_SUPABASE_URL is not set. Copy FE/.env.example to FE/.env and fill it in.')
}
if (!publishableKey) {
  throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY is not set. Copy FE/.env.example to FE/.env and fill it in.')
}

export const supabase = createClient(url, publishableKey)
