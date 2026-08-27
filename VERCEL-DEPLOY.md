# ARCO — Vercel Test Build

## Deploy on Vercel

Create a new Vercel project from this repository and set:

- Root Directory: `arco`
- Framework Preset: `Other`
- Build Command: leave empty
- Output Directory: `.`
- Install Command: leave empty

Then deploy.

This is a static/client-side build. Documents currently remain local to the browser
(using the app's existing persistence); Vercel does not provide cloud storage or
multiplayer collaboration.

The included service worker enables offline-after-first-load testing in supported
browsers.
