import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'src-tauri'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // React 18 不需要 import React
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // 禁止 any
      '@typescript-eslint/no-explicit-any': 'error',
      // 未使用变量报错（允许下划线前缀）
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // 禁止 console（允许 warn/error）
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // 关闭 set-state-in-effect：该规则面向 React 19 + React Compiler 优化
      // 项目用 React 18，effect 内初始化加载 / 轮询 / 同步 localStorage 是合法模式
      // 强制改用 useSyncExternalStore 会引入不必要的复杂度，收益不大
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  prettier
);
