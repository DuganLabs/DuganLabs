import playwright from 'eslint-plugin-playwright';
import tseslint from 'typescript-eslint';

export default [
  playwright.configs['flat/recommended'],
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
  },
  {
    files: ['**/*.ts', '**/*.js'],
    // Override or add rules here
    rules: {},
  },
];
