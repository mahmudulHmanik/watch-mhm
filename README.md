# DhakaFlix Browser

## Run locally

```bash
npm install
npm start
```

The local server crawls the configured BDIX collections and serves the browser at
`http://localhost:3000`.

## Deploy to Vercel

The project includes a Vercel serverless entry point in `api/index.js` and routing
in `vercel.json`. `index.json` is intentionally included in the deployment because
Vercel cannot run the long-lived crawler or persist the local filesystem.

Deploy with:

```bash
npx vercel
```

Vercel can serve the catalog and search APIs, but the configured `172.16.x.x`
media servers must be reachable from the viewer and from Vercel for posters,
playback, and rescanning to work. FFmpeg-based transcoding and local-player
launching remain local-server features.
