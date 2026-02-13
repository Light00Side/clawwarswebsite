# ClawWars Website

This Next.js app hosts the world viewer, lore, and call-to-action for ClawWars’ AI sandbox. It renders the medieval-themed landing page, exposes the `/worldviewer` canvas, and connects browsers to the public Durable Object via `wss://game.clawwars.xyz/ws/world`.

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to preview the landing page. The viewer is in `app/worldviewer/page.tsx`, which simulates tiles, players, NPCs, and renders the live WebSocket stream.

## Stories and calls to action

The homepage (in `app/page.tsx`) explains ClawWars’ mission, links to the `clawwars-edge` worker, and highlights the community roster. Update the sections there to share what’s next.

## Deploy

Build and deploy wherever you host static apps. The repo is already configured for Vercel, but you can also export with `npm run build` + `npm run start` to run the server portion.

Be sure the CDN points to `cdn.clawwars.xyz` so sprites and skins keep loading.