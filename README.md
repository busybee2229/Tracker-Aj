# 👶 Naina's Baby Registry

A warm, static baby **registry + private deal tracker** for India · UK · Canada
(prices shown in ₹). Family/friends see a read-only registry of finalised picks;
you and your wife log in as **admin** to research, add, edit and finalise items.

- **Live:** https://tracker-aj.vercel.app
- **Host:** Vercel (auto-deploys on push to `main`)
- **Sync DB:** Supabase project `nrpjtychwmuecmskehyj`, table `tracker_state`

## How it works
- **Catalogue** lives in `products.json` (base items, each with top-3 options,
  images, `bestRegion`). The page shell + design system is `index.html`; all app
  logic is `app.js`.
- **Your edits** (added items/options, finalised pins, quantities, status, track)
  live in **Supabase** and sync live across devices (Realtime + a 5s poll).
- **Prices** live in `prices.json`, written by a free GitHub Action twice daily
  (best-effort — see below).

## Files
| File | Purpose |
|---|---|
| `index.html` | Shell + full CSS (the design system). Loads `app.js`. |
| `app.js` | All app logic; reads `products.json` + `prices.json`; syncs via Supabase. |
| `products.json` | Catalogue (57 base items) + top-3 options + images + `bestRegion`. |
| `prices.json` | `{updated, items, images}` written by the price job. |
| `scripts/fetch-prices.mjs` | Free product-page price + og:image reader (Shopify/JSON-LD/meta). |
| `.github/workflows/update-prices.yml` | Twice-daily price job → commits `prices.json`. |
| `.github/workflows/backup-state.yml` | Daily backup of the Supabase shared row → `state-backup.json`. |
| `supabase/functions/save-state/` | Edge Function: the only authorized write path (see SECURITY-SETUP.md). |
| `vercel.json` | Security headers (CSP) + no-cache. |
| `DESIGN.md` | Apple-grade design principles (standing instruction). |
| `SECURITY-SETUP.md` | One-time Supabase RLS + Edge Function + secret setup. |

## Security model (read this)
- **Friends are read-only.** Supabase RLS lets anonymous visitors *read* the shared
  row but not write it. (Run the SQL in `SECURITY-SETUP.md` to enable this.)
- **Writes go through an Edge Function** that verifies the admin password against a
  server-side secret and writes with the service-role key. The SHA-256 hash in
  `app.js` is only an instant UX gate — the real check is server-side.
- See **`SECURITY-SETUP.md`** for the one-time setup and the required deploy order.

## Deploy
```bash
cd ~/Tracker
git add -A && git commit -m "describe change" && git push   # Vercel redeploys in ~30s
```
> **First-time / after pulling these security changes:** deploy the Edge Function and
> set the `ADMIN_PASSWORD` secret **before** (or together with) pushing the site, or
> admin saves will fail until the function exists. See `SECURITY-SETUP.md`.

## Prices (caveats)
- The free reader prices only items that expose machine-readable data on their
  product page (Shopify/JSON-LD/meta) — currently ~10 items; the rest stay blank
  because big retailers (e.g. Amazon) block scrapers.
- ₹ is computed from the stored **local price + currency at display time** using the
  current FX rate, so price history and "deals" reflect real price moves, not
  currency swings.
- A shown price may come from a different market than the item's "Buy best" link;
  the card now shows the price's **market flag** to make that clear.
- For exact Amazon prices across IN/UK/CA, plug a price API (e.g. Keepa/SerpAPI)
  into `scripts/fetch-prices.mjs` where `extractPrice` is called.

## Editing
- Add/delete items, finalise picks, set quantities/status in the admin Dashboard.
- **Export edits** downloads a JSON backup; **Import** restores it.
