/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        base: 'var(--base)',
        'base-2': 'var(--base-2)',
        panel: 'var(--panel)',
        'panel-2': 'var(--panel-2)',
        line: 'var(--line)',
        'line-2': 'var(--line-2)',
        text: 'var(--text)',
        muted: 'var(--muted)',
        faint: 'var(--faint)',
        lit: 'var(--lit)',
        accent: 'var(--accent)',
        good: 'var(--good)',
        warn: 'var(--warn)',
        crit: 'var(--crit)',
        agent: {
          sage: 'var(--sage)', rex: 'var(--rex)', nova: 'var(--nova)',
          vega: 'var(--vega)', atlas: 'var(--atlas)', zen: 'var(--zen)',
        },
      },
      fontFamily: {
        sans: ['Archivo', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        wide: ['"Archivo Expanded"', 'Archivo', 'sans-serif'],
        mono: ['"Martian Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [],
};
