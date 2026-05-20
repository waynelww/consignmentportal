import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        xocks: {
          black: '#0A0A0A',
          gold: '#FFD700',
          success: '#22C55E',
          warning: '#F59E0B',
          error: '#EF4444',
          bg: '#F8F8F8',
          card: '#FFFFFF',
          muted: '#6B7280',
          border: '#E5E7EB',
        },
      },
      fontFamily: {
        mono: ['var(--font-mono)', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
