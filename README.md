# UK Academic Funding Hub (GitHub Pages)

A GitHub Pages-ready UK academic funding aggregator with:

- Daily collection from multiple UK funding sources
- AI-generated summaries for quick triage
- Profile-based fit score (0-100)
- Advanced filtering (sort, min-fit threshold, open-only, closing-soon)
- Saved state via URL + local storage for shareable views
- Daily Markdown digest
- Email subscription (Buttondown)
- Automated QA checks (unit tests + dataset contract validation)

## Project Structure

- `config/sources.json`: Funding source registry (easy to extend)
- `scripts/update-funding.mjs`: Daily fetch + dedupe + AI summary + dataset build
- `scripts/send-digest.mjs`: Sends the daily email digest (Buttondown API)
- `scripts/validate-data.mjs`: Validates generated dataset shape and critical fields
- `docs/`: Static site for GitHub Pages
- `.github/workflows/daily-refresh.yml`: Daily scheduled refresh workflow
- `.github/workflows/deploy-pages.yml`: Pages deployment workflow
- `.github/workflows/quality-check.yml`: CI test + data validation workflow

## Run Locally

```bash
npm run update:data
npm run send:digest
npm run test
npm run validate:data
npm run qa
```

Generated outputs:

- `docs/data/funding.latest.json`
- `docs/data/funding.index.json`
- `docs/data/digest.latest.md`
- `docs/data/site-config.json`

Use any static server to preview `docs/index.html`.

## Deploy to GitHub Pages

1. Push to `main`.
2. In repository settings, enable `Pages` and set Source to `GitHub Actions`.
3. `Deploy GitHub Pages` workflow deploys `docs/` automatically.

## Daily Refresh and Email Setup

### Secrets

- `OPENROUTER_API_KEY`: AI summary generation (optional; falls back to heuristic summaries if missing)
- `BUTTONDOWN_API_KEY`: Daily digest email sending (optional)

### Variables

- `OPENROUTER_MODEL`: default `openrouter/free`
- `OPENROUTER_MODELS`: optional comma-separated fallback model list (takes priority over `OPENROUTER_MODEL`)
- `OPENROUTER_SITE_URL`: optional OpenRouter `HTTP-Referer` header
- `OPENROUTER_SITE_NAME`: optional OpenRouter `X-Title` header
- `BUTTONDOWN_USERNAME`: your Buttondown username (used by frontend subscribe form)
- `BUTTONDOWN_NEWSLETTER_ID`: optional when using multiple newsletters
- `BUTTONDOWN_DRY_RUN`: `true` creates draft only, does not send
- `MAX_ITEMS_PER_SOURCE`: max detail pages fetched per source (default 18)
- `MAX_TOTAL_ITEMS`: global retained item limit (default 320)

## Subscription Model

Because GitHub Pages is static hosting, this project uses Buttondown for subscriptions:

- Users submit email from the webpage
- Form posts directly to Buttondown public subscribe endpoint (double opt-in)
- Daily workflow sends the digest to subscribers

## Add/Adjust Funding Sources

Edit `config/sources.json` and append entries like:

```json
{
  "id": "source-id",
  "name": "Source Name",
  "category": "research_grants",
  "homepage": "https://example.com/funding",
  "seedUrls": ["https://example.com/funding"],
  "includeHosts": ["example.com"]
}
```

## Notes

- Automated collection depends on source page structure and anti-bot policies.
- AI summaries are for prioritization only and are not application advice.
- Always verify eligibility, deadlines, and requirements on official pages.
- For quality standards and test coverage baseline, see `docs/qa-research.md`.
