# YU-Gi-Oh! Rush Format Pack Opener

Heavy-alpha pack opener for YU-Gi-Oh! Rush Duel / Rush Format built with Astro and Cloudflare Workers.

It currently provides the basic loop for browsing Rush Duel booster packs, selecting how many packs to open, and generating simulated pulls from Yugipedia data. The project is intentionally early-stage and still has rough edges.

## Current State

- Pack list page with sorting and quantity selection.
- Pack opening API that rolls cards based on rarity weights.
- Results page that groups opened packs and shows pulled cards.
- Cloudflare KV caching for booster packs, pack card lists, and opening sessions.

## Known Limitations

- Card images are incomplete for now there is text-only display for packs, it is possible to add cards display by adding path to env 'IMAGES_DB' that would point to storage with cards images in .jpg format.
- This is a alpha build, so behavior and data quality may still change.

## Tech Stack

- Astro
- Cloudflare Workers
- Cloudflare KV
- Yugipedia API

## Project Structure

- `/` — landing page and pack selection UI.
- `/packs` — pack opening results view.
- `/api/open-packs` — server endpoint that generates simulated openings.

## Getting Started

### Requirements

- Node.js 22.12 or newer.
- A Cloudflare account with KV namespaces configured.

### Install

```bash
npm install
```

### Run Locally

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Preview the Production Build

```bash
npm run preview
```

### Deploy to Cloudflare

```bash
npm run deploy
```

## Configuration

The app expects the following Cloudflare bindings:

- `BACKEND_URL` — Yugipedia API endpoint, currently set to `https://yugipedia.com/api.php`.
- `YGO_KV` — KV namespace used for caching and opening sessions.
- `IMAGES_DB` — Optional env variable that is used for displaying images for cards, in case of use the images must be in .jpg format and their filename must corespond to their card ID used in Project Ignis
The sample `wrangler.jsonc` also includes a `SESSION` KV binding, but the app code currently uses `YGO_KV` for storage.

## How It Works

1. The home page fetches Rush Duel booster packs from Yugipedia and caches them.
2. You choose one or more packs and how many copies to open.
3. The API rolls 9 cards per pack using weighted rarity odds.
4. The session is stored in KV and the results page renders the pull history.

## Roadmap

- Tighten data validation and error handling.
- Fix KR only packs not opening
- Improve pack presentation for a more complete release.

## License

No license has been added yet.
