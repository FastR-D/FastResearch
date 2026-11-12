/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },
        accent: {
          50: '#e8f3ff',
          100: '#d0e5ff',
          200: '#b7d8ff',
          300: '#8dc8e8',
          400: '#5ba7ff',
          500: '#2f8af5',
          600: '#1769d3',
          700: '#004ab2',
          800: '#003a8f',
          900: '#002d70',
          950: '#001b45',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Noto Sans SC', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      borderRadius: {
        xl: '0.75rem',
        '2xl': '1rem',
        '3xl': '1.25rem',
      },
      boxShadow: {
        sm: '0 4px 12px rgba(16, 24, 40, 0.06)',
        md: '0 12px 36px rgba(16, 24, 40, 0.08)',
        lg: '0 24px 64px rgba(16, 24, 40, 0.14)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-down': {
          from: { opacity: '0', transform: 'translateY(-8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in .3s ease-out both',
        'slide-up': 'slide-up .3s ease-out both',
        'slide-down': 'slide-down .3s ease-out both',
        'scale-in': 'scale-in .2s ease-out both',
      },
    },
  },
  plugins: [],
}
