/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      // 主色替换 = 换表操作(设计语言 §02):token 真源在 kernel/design/tokens.css
      colors: {
        bg: 'rgb(var(--mp-c-bg) / <alpha-value>)',
        // Theme v3: every card surface is translucent by default — the fill
        // alpha is slider-driven (--mp-card-fill-alpha, from design/acrylic.ts);
        // explicit /xx modifiers compose with it via calc.
        card: 'rgb(var(--mp-c-card) / calc(<alpha-value> * var(--mp-card-fill-alpha, 1)))',
        ink: {
          DEFAULT: 'rgb(var(--mp-c-ink) / <alpha-value>)',
          2: 'rgb(var(--mp-c-ink-2) / <alpha-value>)',
          3: 'rgb(var(--mp-c-ink-3) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'rgb(var(--mp-c-primary) / <alpha-value>)',
          pressed: 'rgb(var(--mp-c-primary-pressed) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--mp-c-accent) / <alpha-value>)',
          wash: 'var(--mp-accent-wash)',
        },
        // 聊天配色通道(色系 v2):真源在 tokens.css,选中色系经 <html> 内联
        // 变量按当前明暗成套接管;不设独立 chat 背景(表面走 bg/card 令牌)
        chat: {
          accent: 'rgb(var(--mp-c-chat-accent) / <alpha-value>)',
          'bubble-user': 'rgb(var(--mp-c-bubble-user) / <alpha-value>)',
          'on-bubble-user': 'rgb(var(--mp-c-on-bubble-user) / <alpha-value>)',
          'bubble-ai': 'rgb(var(--mp-c-bubble-ai) / <alpha-value>)',
          'on-bubble-ai': 'rgb(var(--mp-c-on-bubble-ai) / <alpha-value>)',
        },
        'on-primary': 'rgb(var(--mp-c-on-primary) / <alpha-value>)',
        line: {
          DEFAULT: 'var(--mp-line)',
          strong: 'var(--mp-line-strong)',
        },
        danger: {
          DEFAULT: 'var(--mp-danger)',
          wash: 'var(--mp-danger-wash)',
        },
        mint: {
          100: 'rgb(var(--mp-mint-100) / <alpha-value>)',
          200: 'rgb(var(--mp-mint-200) / <alpha-value>)',
          300: 'rgb(var(--mp-mint-300) / <alpha-value>)',
          400: 'rgb(var(--mp-mint-400) / <alpha-value>)',
        },
        teal: {
          400: 'rgb(var(--mp-teal-400) / <alpha-value>)',
          500: 'rgb(var(--mp-teal-500) / <alpha-value>)',
          600: 'rgb(var(--mp-teal-600) / <alpha-value>)',
          700: 'rgb(var(--mp-teal-700) / <alpha-value>)',
        },
        cyan: {
          500: 'rgb(var(--mp-cyan-500) / <alpha-value>)',
        },
      },
      borderRadius: {
        input: 'var(--mp-radius-input)',
        card: 'var(--mp-radius-card)',
        panel: 'var(--mp-radius-panel)',
        action: 'var(--mp-radius-action)',
        'bubble-user': 'var(--mp-radius-bubble-user)',
        'bubble-ai': 'var(--mp-radius-bubble-ai)',
      },
      fontFamily: {
        sans: 'var(--mp-font-sans)',
        mono: 'var(--mp-font-mono)',
      },
    },
  },
  plugins: [],
}
