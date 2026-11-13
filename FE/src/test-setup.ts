import { cleanup } from '@testing-library/react'
import { notifyManager } from '@tanstack/react-query'
import { afterEach } from 'vitest'

// Testing Library only auto-cleans when a global afterEach exists; Vitest has none by default.
afterEach(cleanup)

// react-query는 결과 알림을 setTimeout(0)으로 미룬다. 가짜 타이머 시험에서 알림이 타이머 창 밖으로 밀리지 않게 바로 알린다.
notifyManager.setScheduler((cb) => {
  cb()
})
