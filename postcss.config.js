export default {
  plugins: {
    // Inline @import-ed partials (tokens.css / base.css) into main.css before
    // the tailwind plugin runs — Vite 8's dev pipeline processes each CSS file
    // as its own module, and a module using @layer without the matching
    // @tailwind directive makes tailwindcss throw ("no matching @tailwind base
    // directive is present"), which put an error overlay over the whole app.
    'postcss-import': {},
    tailwindcss: {},
    autoprefixer: {},
  },
}
