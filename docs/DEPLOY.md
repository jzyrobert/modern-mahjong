# Deployment

This repo ships two deployable artifacts, both built and deployed by GitHub Actions on every push to `main`:

| Surface         | Where it runs                                | Tier needed                                            |
| --------------- | -------------------------------------------- | ------------------------------------------------------ |
| Client (web)    | Cloudflare Pages (`modern-mahjong`)          | Free                                                   |
| Server          | Cloudflare Workers + Durable Objects         | Workers Paid ($5/mo) — Durable Objects require this    |
| Client (Android) | APK uploaded as a workflow artifact          | Free                                                   |

> **Heads-up.** The free Workers plan does *not* include Durable Objects. Because partyserver rooms are DOs, the server deploy needs **Workers Paid**. Pages and the Android APK both stay free.

## One-time setup

You'll do this once, in this order. The workflow at [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) handles the actual deploys.

### 1. Cloudflare account

- Sign up at <https://dash.cloudflare.com>.
- Note your **Account ID** (sidebar of any zone, or in the URL after `dash.cloudflare.com/`).
- Subscribe to **Workers Paid** under "Workers & Pages → Plans" if you want the online server. (Skip if you'll only use LAN play.)

### 2. API token

- In the Cloudflare dashboard: **My Profile → API Tokens → Create Token**.
- Use the **"Edit Cloudflare Workers"** template.
- Add a second permission: **Account → Cloudflare Pages → Edit**.
- Copy the token — you only see it once.

### 3. GitHub secrets

In **GitHub → Settings → Secrets and variables → Actions → New repository secret**, add:

| Name                  | Value                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`| The token from step 2.                                                                                      |
| `CLOUDFLARE_ACCOUNT_ID`| Your account ID from step 1.                                                                              |
| `VITE_SERVER_URL`     | The deployed Worker's URL — fill in **after the first server deploy** (see below). Example: `https://modern-mahjong-server.your-subdomain.workers.dev`. |

### 4. First deploy

Push any commit to `main`. The workflow will:

1. **Deploy the Worker first.** On success, look at the Action logs — wrangler prints the worker URL (e.g. `https://modern-mahjong-server.your-subdomain.workers.dev`).
2. **Deploy Pages second.** The `deploy-client` job runs `wrangler pages project create modern-mahjong` (idempotent — succeeds if the project already exists) and then deploys the bundle. The build picks up `VITE_SERVER_URL` if you've set it; otherwise it hard-fails the job.

If this is the *very* first deploy, `VITE_SERVER_URL` is still empty and the `deploy-client` job will **fail loudly** rather than silently bake `http://localhost:8787` into the production bundle. Fix it by adding the secret (step 3 above) and re-running the workflow:

- **Actions → deploy → Re-run all jobs**, or
- push another commit.

Subsequent deploys are fully automated.

## Production URL

The project root is **`https://modern-mahjong.pages.dev`** — that's the URL you bookmark and share. Each individual deploy *also* gets a unique hashed alias (e.g. `https://7b19a3.modern-mahjong.pages.dev`) for stable historical access; that's what wrangler logs at the end of `pages deploy`. Both are valid; the root URL just always reflects the *latest production* deploy.

A deploy lands on production iff the project's **Production branch** setting matches the `--branch=` argument we pass (`main`). Our CI creates the project with `--production-branch=main`, so this works out of the box for fresh setups.

**If your deploys are landing on hashed preview URLs but the root URL never updates**, the project's Production branch is probably set to something else (often `production`, the Cloudflare default if the project was created via the dashboard). Fix it once in the dashboard:

1. Cloudflare dashboard → **Workers & Pages → modern-mahjong → Settings → Builds & deployments**
2. **Production branch** → change to `main` → Save
3. Re-run the deploy workflow. Subsequent runs will update `https://modern-mahjong.pages.dev`.

Alternative if you'd rather start clean: `wrangler pages project delete modern-mahjong` (run locally with the API token) and let CI recreate it on the next push — the auto-create call uses `--production-branch=main`.

## Custom domain (optional)

By default you'll get:
- Client: `https://modern-mahjong.pages.dev`
- Server: `https://modern-mahjong-server.<your-subdomain>.workers.dev`

To use your own domain:
- **Pages**: project settings → Custom domains → add.
- **Workers**: `wrangler.toml` → add `routes = [{ pattern = "api.example.com/*", custom_domain = true }]` and set `VITE_SERVER_URL=https://api.example.com` in GitHub secrets.

## Local-only development

Nothing in this guide is required to run the app locally. `pnpm dev` (in `apps/server` and `apps/client`) starts the same code against `localhost:8787` / `localhost:5173`. LAN play runs entirely peer-to-peer between devices on the same Wi-Fi and never touches Cloudflare.

## Android APK

Every CI run on `main` (and on PRs touching the client) produces a debug-signed APK and uploads it as the `client-apk-debug` workflow artifact. Download from the run summary page — it expires after 14 days.

To install on a device, enable "Install unknown apps" for your browser/file manager, transfer the APK, and tap to install. For production / Play Store releases you'll need to add a release-signing keystore and switch the gradle task from `assembleDebug` to `assembleRelease` — left for the maintainer when you're ready to publish.

## Why these tools

- **Cloudflare Pages** for the client: free, edge-cached, deploys from GitHub in ~30s, gives you `https://` for free (needed for camera APIs in the future).
- **Cloudflare Workers + Durable Objects** for the server: partyserver is built on DOs; the same code works locally (`wrangler dev`) and in production with no rewrites. Each match code maps 1:1 to a single-threaded DO, which is what makes claim resolution race-condition-proof.
- **GitHub-hosted runners** for the Android APK: no Android Studio needed locally — `setup-java` + Capacitor + Gradle do everything in a clean `ubuntu-latest` runner. APKs are reproducible from the source tree alone.
