import js from '@eslint/js'
import betterTailwind from 'eslint-plugin-better-tailwindcss'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// selectors를 주면 기본 목록이 통째로 바뀐다. className과, 변종을 담는 variants 객체의 값을 검사한다.
const tailwindSelectors = [
  { kind: 'attribute', name: '^className$' },
  { kind: 'variable', name: '^variants$', match: [{ type: 'objectValues' }] },
]

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  reactHooks.configs.flat.recommended,
  jsxA11y.flatConfigs.recommended,
  reactRefresh.configs.vite,
  {
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // 설정 파일은 tsconfig 밖이고 jsx-a11y는 타입이 없어서 타입 검사 규칙을 쓰지 않는다.
  { files: ['**/*.js'], extends: [tseslint.configs.disableTypeChecked] },
  {
    // 가로 스크롤되는 region(Table, LogBlock)은 키보드로 포커스해야 해서 tabIndex를 둔다.
    rules: {
      'jsx-a11y/no-noninteractive-tabindex': ['error', { roles: ['tabpanel', 'region'] }],
    },
  },
  {
    // 기본 팔레트를 비웠기 때문에 bg-white 같은 클래스는 CSS가 만들어지지 않고 조용히 무시된다. 정의되지 않은 클래스만 막는다.
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'better-tailwindcss': betterTailwind },
    settings: { 'better-tailwindcss': { entryPoint: 'src/styles/theme.css' } },
    rules: {
      'better-tailwindcss/no-unknown-classes': ['error', { selectors: tailwindSelectors }],
      // 비운 팔레트를 임의값(bg-[#6366f1])으로 우회하거나, 로드하지 않은 굵기 · 그림자를 쓰는 것을 막는다.
      'better-tailwindcss/no-restricted-classes': [
        'error',
        {
          selectors: tailwindSelectors,
          restrict: [
            {
              pattern: '(^|:)!?-?[a-z][a-z0-9-]*-\\[',
              message: '임의값 클래스는 쓰지 않는다. 토큰(theme.css)을 쓰거나 토큰을 추가한다.',
            },
            {
              pattern: '(^|:)font-(thin|extralight|light|medium|semibold|black)$',
              message: '로드한 굵기는 400(font-normal) · 700(font-bold) · 800(font-extrabold)뿐이다.',
            },
            {
              pattern: '(^|:)(drop-shadow|inset-shadow|text-shadow|ring|inset-ring)(-|$)',
              message: '그림자는 쓰지 않는다. 모달이 생기면 토큰을 먼저 추가한다.',
            },
          ],
        },
      ],
    },
  },
)
