/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        display: ["Fraunces", "Georgia", "serif"],
        body: ["'Hanken Grotesk'", "system-ui", "sans-serif"],
      },
      colors: {
        felt: {
          DEFAULT: "#1a6b54",
          dark: "#0f5240",
          light: "#2a8568",
        },
      },
    },
  },
  plugins: [],
};
