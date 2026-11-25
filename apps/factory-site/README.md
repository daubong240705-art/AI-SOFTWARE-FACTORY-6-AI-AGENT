# Factory Site

A static product site and documentation SPA. Vietnamese is the default. English covers the landing and demo pages as well as the Getting Started and Concepts docs; other docs fall back to Vietnamese.

## Development and production

From `apps/factory-site`, with Node.js 22.20+ and the package dependencies available:

```bash
npm run dev     # Vite development server on loopback
npm run build   # TypeScript check, then Vite output to dist/
npm run serve   # runs node server.mjs
```

The static server defaults to `0.0.0.0:8810`. Override `HOST` and `PORT` for your deployment; use `HOST=127.0.0.1` to serve locally only. Hash routes work on other static hosts that serve `index.html` at the site root. Missing screenshot files in `public/images/` fall back to placeholders on the landing page.

## Demo and documentation

Optionally set `VITE_DEMO_TOKEN` when building to show the **public demo** token. Vite embeds it in the client bundle; never use a private credential or a real Factory instance's token here. Without it, the demo page tells visitors to ask the administrator.

Add documentation to `docs/vi/` and matching translations to `docs/en/`. Keep the same slug, section and order across languages; use `title`, `section`, and `order` frontmatter. Link to other pages with relative `.md` links and reference local screenshots under `images/`. Raw HTML is omitted. Copied Inter font licensing is in `public/fonts/Inter-LICENSE.txt`.
