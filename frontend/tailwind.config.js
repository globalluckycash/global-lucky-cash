/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bch: {
          DEFAULT: '#0AC18E',
          glow: '#00FFC2',
          dark: '#051f18',
        },
        bg: {
          main: '#0F1115',
          card: '#181B21',
        },
      },
      boxShadow: {
        neon: '0 0 10px rgba(10, 193, 142, 0.4), 0 0 20px rgba(10, 193, 142, 0.2)',
        'neon-strong': '0 0 15px rgba(0, 255, 194, 0.6), 0 0 30px rgba(0, 255, 194, 0.3)',
      },
      keyframes: {
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 10px rgba(0, 255, 194, 0.5), 0 0 20px rgba(0, 255, 194, 0.25)' },
          '50%': { boxShadow: '0 0 20px rgba(0, 255, 194, 0.9), 0 0 40px rgba(0, 255, 194, 0.5)' },
        },
        'glow-pulse-amber': {
          '0%, 100%': { boxShadow: '0 0 10px rgba(251, 191, 36, 0.35), 0 0 20px rgba(251, 191, 36, 0.15)' },
          '50%': { boxShadow: '0 0 18px rgba(251, 191, 36, 0.7), 0 0 34px rgba(251, 191, 36, 0.35)' },
        },
      },
      animation: {
        'glow-pulse': 'glow-pulse 1.8s ease-in-out infinite',
        'glow-pulse-amber': 'glow-pulse-amber 1.8s ease-in-out infinite',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['Space Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
