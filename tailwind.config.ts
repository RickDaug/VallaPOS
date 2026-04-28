import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        valla: {
          dark: '#111827',
          green: '#16a34a',
          soft: '#f3f4f6'
        }
      }
    }
  },
  plugins: []
};

export default config;
