// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'dist/**', 'generated/**', 'coverage/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
  {
    /**
     * Script seed là JavaScript thuần chạy bằng `node`, không nằm trong
     * `tsconfig.json`. `projectService` sẽ báo "was not found by the project
     * service" khi mở chúng trong editor.
     *
     * Tắt các luật cần thông tin kiểu, giữ lại phần còn lại (biến thừa, cú
     * pháp, prettier) — chúng vẫn là mã chạy thật trên production.
     *
     * Khối này phải đứng **cuối cùng**: flat config lấy khối sau đè khối trước,
     * nên đặt trước khối `rules` ở trên thì `no-floating-promises` bật lại và
     * ESLint lại đòi thông tin kiểu.
     */
    files: ['prisma/**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: null,
      },
    },
    rules: {
      // Script chạy trực tiếp bằng `node`, không qua bundler — `require()` là
      // đúng cách ở đây, không phải thiếu sót cần chuyển sang `import`.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
