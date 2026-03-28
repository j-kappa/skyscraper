# Skyscraper

Render any website as a 3D cityscape. Enter a URL and Skyscraper fetches the page, screenshots it with html2canvas, walks the DOM tree to extract visible elements, and builds a Three.js scene where each element becomes a 3D block — deeper DOM nodes rise higher, creating a relief-map effect of the page's structure.

## Features

- **DOM-depth elevation** — child elements always sit above their parents, so page content is never buried by container blocks
- **Screenshot textures** — each block's top face is cropped from the real html2canvas screenshot, preserving text, images, and colors
- **Real sun position** — lighting uses SunCalc to match the actual sun angle for your location and time
- **Shadow mapping** — PCF soft shadows cast across the cityscape based on the sun direction
- **Rounded corners** — elements with `border-radius` render as extruded rounded shapes
- **CORS proxy** — external stylesheets and images are fetched through a proxy and inlined so html2canvas can capture them
- **Form control replacement** — `<input>`, `<button>`, `<textarea>`, and `<select>` elements are swapped for styled `<div>`s that html2canvas can render

## Architecture

```
src/
  main.ts       — app entry point, URL form handling, scene lifecycle
  fetcher.ts    — fetches remote HTML via CORS proxy
  parser.ts     — iframe rendering, style/image inlining, html2canvas screenshot, DOM walker
  builder.ts    — converts ElementBlock[] + screenshot into Three.js meshes with textures
  scene.ts      — Three.js scene, camera, renderer, OrbitControls, post-processing
  sun.ts        — directional light positioned by real solar coordinates (SunCalc)
  types.ts      — shared TypeScript interfaces (ElementBlock, ParseResult)
```

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5174` and enter a URL.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | Type-check with `tsc` then build for production |
| `npm run preview` | Serve the production build locally |

## Dependencies

| Package | Purpose |
|---------|---------|
| [three](https://threejs.org/) | WebGL 3D rendering |
| [html2canvas](https://html2canvas.hertzen.com/) | Client-side page screenshots |
| [suncalc](https://github.com/mourner/suncalc) | Solar position calculations |

## How It Works

1. **Fetch** — the target page's HTML is retrieved through a CORS proxy (`fetcher.ts`)
2. **Render** — the HTML is loaded into a hidden iframe; external stylesheets and images are inlined via the proxy (`parser.ts`)
3. **Screenshot** — html2canvas captures the rendered iframe content as a canvas
4. **Walk** — the DOM tree is traversed recursively, producing an `ElementBlock` for each visible element with its position, size, depth, background color, and border radius
5. **Build** — each block becomes a Three.js box (or rounded extrusion) whose height is proportional to DOM depth, with the screenshot region mapped onto its top face (`builder.ts`)
6. **Light** — a directional light is placed at the real sun position for the user's coordinates and current time (`sun.ts`)

## Limitations

- Pages behind authentication or requiring JavaScript rendering (SPAs with no SSR) will not display correctly
- Images hosted on servers that block proxy requests (e.g. Cloudflare-protected CDNs) may appear blank
- Very large pages are capped at 3x viewport height to keep rendering manageable
