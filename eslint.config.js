import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'android/**', 'documents/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
        sourceType: 'module',
      },
    },
  },
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // 根组件 App 为 Vue 单文件惯例命名,豁免多词组件名规则
      'vue/multi-word-component-names': 'off',
    },
  },

  // ── 红线(章程 §3.5.4)───────────────────────────────────────────
  // 1) kernel 零具体功能 import:kernel 禁止 import plugins/*
  {
    files: ['src/kernel/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/plugins', '@/plugins/**', '**/plugins', '**/plugins/**'],
              message:
                '红线(章程 §3.5.4):kernel 禁止 import 具体功能(plugins/*)。插件经注册表/公开 API 反向入驻。',
            },
          ],
        },
      ],
    },
  },
  // 2) plugins 禁 import kernel 内部符号;公开面唯一入口 = @contracts 契约包
  //    barrel-only(ADR-001 R-05):深路径(@contracts/xxx)与相对路径绕行同禁,
  //    M2 随首个真实插件落地加测(tests/lint/red-lines.spec.ts)。
  {
    files: ['src/plugins/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/kernel', '@/kernel/**', '**/kernel', '**/kernel/**'],
              message:
                '红线(章程 §3.5.4):插件只走公开插件 API(@contracts),禁 import kernel 内部符号。',
            },
            {
              group: [
                '@contracts/*',
                '@contracts/**',
                '@/contracts',
                '@/contracts/**',
                '**/contracts',
                '**/contracts/**',
              ],
              message:
                'barrel-only(ADR-001 R-05):插件唯一入口 = @contracts(barrel);深路径/相对路径绕行禁行。',
            },
          ],
        },
      ],
    },
  },
  // 2b) contracts 是依赖图叶子:契约包禁 import src/**(内核实现契约,契约不依赖内核)
  {
    files: ['contracts/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@', '@/**', '**/src', '**/src/**', '../*', '../**'],
              message:
                '契约真源(contracts/):框架无关、零内核依赖。内核与插件依赖契约,契约不反依赖。',
            },
          ],
        },
      ],
    },
  },
  // 3) RP 血统残留字符串禁入(改名纪律 §04):sta1n / rp_hub_ / RPH
  {
    files: ['src/**/*.{ts,vue}', 'contracts/**/*.ts', 'tests/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value=/sta1n|rp_hub_|RPH/]",
          message: '改名纪律(移植流水 §04):RP 血统残留字符串(sta1n / rp_hub_ / RPH)禁止入库。',
        },
      ],
    },
  },
)
