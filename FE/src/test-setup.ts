import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library only auto-cleans when a global afterEach exists; Vitest has none by default.
afterEach(cleanup)
