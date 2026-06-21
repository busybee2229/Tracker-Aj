# 👶 Baby Deal Tracker

A static dashboard (India · UK · Canada, cheapest in ₹) with per-item top-3 brand
options, three-country links, an Owned view, add/delete, and live prices+photos
fed by a free GitHub Actions cron.

## Files
- `index.html` — the whole dashboard (catalogue embedded). Reads `prices.json` for live data.
- `products.json` — item list + top-3 options the price job reads.
- `prices.json` — written by the job: `{updated, items:{id:[{date,inr,region}]}, images:{id:url}}`.
- `scripts/fetch-prices.mjs` — Node price/image fetcher (no dependencies).
- `.github/workflows/update-prices.yml` — runs the fetcher twice daily and commits.

## Deploy (one-time)
```bash
# from inside this folder
git init
git add .
git commit -m "Baby Deal Tracker"
git branch -M main
git remote add origin https://github.com/<your-username>/baby-deal-tracker.git
git push -u origin main
```
Then on Vercel: **Add New → Project → Import** that repo → **Deploy**.
You'll get a public URL (e.g. `baby-deal-tracker.vercel.app`) to share with family.

## Turn on automated prices & photos
1. The workflow runs automatically on schedule once the repo is on GitHub.
2. To run it immediately: GitHub repo → **Actions** tab → **Update baby prices** → **Run workflow**.
3. It commits `prices.json`; Vercel auto-redeploys; the dashboard then shows live ₹ prices, deal flags and product photos.

### Reliability note
Retailers block automated scrapers from cloud IPs, so the free fetcher is best-effort —
it reliably captures product **images** (og:image) and many prices, but some prices will be
skipped. For rock-solid prices, plug a price API (e.g. a Keepa/SerpAPI key) into
`scripts/fetch-prices.mjs` where `extractPrice` is called.

## Editing on the site
Add/delete items and Track toggles are saved in your browser. Use **Export edits** to
download them and **Import** on another device. To make an edit permanent for everyone,
edit `products.json` and push.
