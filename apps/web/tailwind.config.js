/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { brand: { DEFAULT: "#86BC25", dark: "#43B02A", ink: "#0B0B0B" } },
      fontFamily: { sans: ["Open Sans", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
