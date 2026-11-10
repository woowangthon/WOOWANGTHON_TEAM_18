import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // 설정 파일은 tsconfig 밖이라 타입 검사 규칙을 쓰지 않는다.
  { files: ['**/*.js'], extends: [tseslint.configs.disableTypeChecked] },
)
