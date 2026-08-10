# PulseWatch — GitHub Pages Edition

A database-free, PHP-free Progressive Web App for monitoring website reachability from the browser.

## How checks work on static hosting

GitHub Pages cannot run PHP or another server runtime. This edition therefore checks targets directly from the browser:

- First it tries a normal CORS fetch. If the target allows it, PulseWatch can read the real HTTP status code.
- If the target does not expose CORS, PulseWatch falls back to a `no-cors` reachability request. A successful opaque response means the host responded, but the browser hides the HTTP status code.
- In reachability-only mode, HTTP 4xx/5xx cannot be distinguished from HTTP 2xx/3xx. A server that responds with an error page may still appear reachable.
- HTTPS GitHub Pages may block `http://` targets as mixed content. Use `https://` monitor URLs.

## Notifications

Notifications are local browser notifications triggered when a check actually executes and its state changes. This static GitHub Pages edition does **not** provide guaranteed remote push notifications while all browsers/devices are closed.

When the PWA is open, the selected 1/2/5/10/15/30/60-minute schedule is followed by JavaScript. Browsers that support Periodic Background Sync may perform best-effort checks while closed, but the browser controls when those jobs run.

## For true 24/7 uptime checks

Reliable server-side status codes, exact background schedules, and push alerts require a separate always-on checker/serverless function or an external uptime service. The dashboard can still remain on GitHub Pages and keep its configuration database-free.

## Interface design

This build uses a mobile-first light Material-style interface with flat surfaces, no gradients, no sidebar, responsive monitor cards, a compact desktop top navigation, and a touch-friendly mobile bottom navigation bar.
