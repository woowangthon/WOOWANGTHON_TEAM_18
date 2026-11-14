import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'
import NoticeBanner from '../components/NoticeBanner.tsx'
import PasswordField from '../components/PasswordField.tsx'
import { Button } from '../components/ui/Button.tsx'
import { DiscordIcon } from '../components/ui/Icons.tsx'
import { ApiError, apiFetch } from '../lib/api.ts'
import { queryKeys } from '../lib/query.ts'
import ProfileSection from './ProfileSection.tsx'

const PATH = '/api/profile/discord-webhook'
const HELP_URL = 'https://support.discord.com/hc/ko/articles/228383668'

// 서버는 주소 전체를 다시 주지 않는다. 등록됐는지와 끝 4자(hint)만 온다.
type Webhook = { set: boolean; hint: string | null }

const save = (url: string | null) => apiFetch<Webhook>(PATH, { url }, 'PUT')

// 서비스에 문제가 생겼을 때 알려 줄 Discord 웹후크(스파이크 감지). 웹후크 주소는 그 채널에 글을 쓸 수 있는 비밀이라서
// 입력칸은 가려 두고, 저장하면 칸을 비우며, 화면 상태 밖(localStorage · 주소 · 오류 문구)으로 내보내지 않는다.
function DiscordSection() {
  const queryClient = useQueryClient()
  const current = useQuery({ queryKey: queryKeys.discordWebhook, queryFn: () => apiFetch<Webhook>(PATH) })
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [done, setDone] = useState<'saved' | 'cleared' | null>(null)

  const write = useMutation({
    mutationFn: save,
    onSuccess: (webhook, value) => {
      queryClient.setQueryData(queryKeys.discordWebhook, webhook)
      setUrl('')
      setDone(value === null ? 'cleared' : 'saved')
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'INVALID_WEBHOOK') setError('Discord 웹후크 주소가 아니에요. https://discord.com/api/webhooks/로 시작해야 해요')
      else setFailed(true)
    },
  })

  function submit(value: string | null) {
    setError(null)
    setFailed(false)
    setDone(null)
    write.mutate(value)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // 서버는 값을 다듬지 않을 수 있어서, 복사하다 붙은 앞뒤 공백만 걷어 보낸다.
    const value = url.trim()
    if (value === '') setError('웹후크 주소를 입력해 주세요')
    else submit(value)
  }

  const webhook = current.data
  return (
    <ProfileSection id="discord" title="Discord 알림" icon={<DiscordIcon width={20} height={20} />}>
      <p>서비스에 문제가 생기면 이 Discord 채널로 알려 드려요.</p>
      {current.isError && (
        <NoticeBanner variant="warn" title="등록 상태를 읽지 못했어요">
          사용자 잘못이 아니에요. 잠시 뒤에 다시 시도해 주세요. 아래에서 새로 등록할 수는 있어요.
        </NoticeBanner>
      )}
      {webhook?.set && (
        <p role="status">…{webhook.hint}로 끝나는 웹후크가 등록돼 있어요</p>
      )}
      {webhook && !webhook.set && <p role="status" className="text-muted">등록된 웹후크가 없어요</p>}
      {done === 'saved' && <NoticeBanner variant="ok" title="웹후크를 저장했어요" />}
      {done === 'cleared' && <NoticeBanner variant="ok" title="웹후크를 지웠어요" />}
      {failed && (
        <NoticeBanner title="웹후크를 저장하지 못했어요">
          잠시 뒤에 다시 시도해 주세요. 등록돼 있던 웹후크는 바뀌지 않았어요.
        </NoticeBanner>
      )}
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
        <PasswordField
          label="Discord 웹후크 주소"
          autoComplete="new-password"
          placeholder="https://discord.com/api/webhooks/…"
          value={url}
          onChange={(value) => {
            setUrl(value)
            setError(null)
          }}
          error={error ?? undefined}
          disabled={write.isPending}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={write.isPending} aria-busy={write.isPending}>
            {write.isPending ? '저장하는 중…' : webhook?.set ? '웹후크 바꾸기' : '웹후크 저장'}
          </Button>
          {webhook?.set && (
            <Button
              variant="outline"
              disabled={write.isPending}
              onClick={() => {
                submit(null)
              }}
            >
              웹후크 지우기
            </Button>
          )}
        </div>
      </form>
      <a href={HELP_URL} target="_blank" rel="noopener noreferrer" className="self-start text-sm text-accent-text underline">
        Discord 웹후크 만드는 방법
        <span className="sr-only"> (새 탭에서 열려요)</span>
      </a>
    </ProfileSection>
  )
}

export default DiscordSection
