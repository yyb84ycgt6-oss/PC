<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/29eeb369-088f-4ccd-bda6-77e53eccb448

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Keep AI Studio updates isolated from Vercel production

1. Create and use a dedicated AI Studio branch (example: `ai-studio/experiments`) for AI Studio sync work.
2. Keep production on `main` only.
3. This repository includes `vercel.json` branch deploy guards so only `main` auto-deploys.
4. Keep separate environment files:
   - AI Studio/local: `.env.ai-studio` (use `.env.ai-studio.example` as template)
   - Production/Vercel: `.env.production` (use `.env.production.example` as template)
5. Only merge AI Studio changes into `main` when you explicitly want Vercel production updated.

### Vercel project settings (one-time)

- Production Branch: set to `main`
- Auto-deploy previews: disable in the Vercel dashboard if you want zero preview deploys
