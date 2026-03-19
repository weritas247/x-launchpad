import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // Global ignores
  {
    ignores: ['dist/**', 'node_modules/**', 'client/js/lib/**'],
  },

  // Base JS recommended rules
  js.configs.recommended,

  // Server TypeScript files
  {
    files: ['server/**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-require-imports': 'off', // CJS project uses require() for dynamic imports
      'no-control-regex': 'off', // Terminal app uses control chars in regex
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },

  // Client JavaScript files
  {
    files: ['client/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Libraries loaded via script tags
        hljs: 'readonly',
        Terminal: 'readonly',
        FitAddon: 'readonly',
        WebLinksAddon: 'readonly',
        SearchAddon: 'readonly',
      },
    },
    rules: {
      // Relaxed for module exports - many vars are imported by other modules
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-assignment': 'warn',
      'no-control-regex': 'off', // Terminal app uses control chars in regex
      eqeqeq: ['error', 'always'],
      curly: ['error', 'multi-line'],
    },
  },

  // Disable formatting rules (handled by Prettier)
  prettierConfig
);
