# Deployment

This repo ships three deployable artifacts, all built (and the first
two deployed) by GitHub Actions on every push to `main`:

| Surface         | Where it runs                                | Tier needed                                            |
| --------------- | -------------------------------------------- | ------------------------------------------------------ |
| Client (web)    | Cloudflare Pages (`modern-mahjong`)          | Free                                                   |
| Server          | Cloudflare Workers + Durable Objects         | Workers Paid ($5/mo) — Durable Objects require this    |
| Client (Android) | APK uploaded as a workflow artifact          | Free                                                   |

> **Toolchain note.** The client runs on Expo Router + Metro
> (`expo export --platform web` writes `apps/client/dist/`); the
> previous Vite + Capacitor stack was retired in #80. The Android
> APK comes from `eas build --platform android --local` running on
> the GitHub Actions runner.

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

| Name                       | Value                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`     | The token from step 2.                                                                                                                                 |
| `CLOUDFLARE_ACCOUNT_ID`    | Your account ID from step 1.                                                                                                                           |
| `EXPO_PUBLIC_SERVER_URL`   | The deployed Worker's URL — fill in **after the first server deploy** (see below). Example: `https://modern-mahjong-server.your-subdomain.workers.dev`. (Replaces the legacy `VITE_SERVER_URL` after the Phase 1 toolchain swap. Expo's runtime reads any env var prefixed with `EXPO_PUBLIC_*`.) |
| `EXPO_TOKEN`               | Generated at `expo.dev → Account Settings → Access Tokens`. Authenticates `eas build --local` on the GitHub Actions runner. No EAS cloud usage; just identity for the CLI. Required for the `build-mobile-android` job. |

### 4. First deploy

Push any commit to `main`. The workflow will:

1. **Deploy the Worker first.** On success, look at the Action logs — wrangler prints the worker URL (e.g. `https://modern-mahjong-server.your-subdomain.workers.dev`).
2. **Deploy Pages second.** The `deploy-client` job runs `wrangler pages project create modern-mahjong` (idempotent — succeeds if the project already exists), runs `pnpm --filter @mahjong/client export-web` to produce `apps/client/dist/`, then deploys the bundle. The build picks up `EXPO_PUBLIC_SERVER_URL` if you've set it; otherwise it hard-fails the job.

If this is the *very* first deploy, `EXPO_PUBLIC_SERVER_URL` is still empty and the `deploy-client` job will **fail loudly** rather than silently bake `http://localhost:8787` into the production bundle. Fix it by adding the secret (step 3 above) and re-running the workflow:

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
- **Workers**: `wrangler.toml` → add `routes = [{ pattern = "api.example.com/*", custom_domain = true }]` and set `EXPO_PUBLIC_SERVER_URL=https://api.example.com` in GitHub secrets.

## Local-only development

Nothing in this guide is required to run the app locally. The
client uses Expo Router + Metro now; the developer flow is:

- `pnpm --filter @mahjong/client start` — Metro dev server. With
  an Android emulator running, hit `a` (or `expo start --android`)
  to install Expo Go and load the JS bundle. The first run on a
  fresh emulator needs `adb reverse tcp:8081 tcp:8081` so Expo
  Go can reach Metro at the host's localhost.
- `pnpm --filter @mahjong/server dev` — `wrangler dev` against
  `localhost:8787`. The client's transport defaults to that URL
  if `EXPO_PUBLIC_SERVER_URL` is unset.
- LAN play runs entirely peer-to-peer between devices on the same
  Wi-Fi and never touches Cloudflare. The native LAN host bridge
  ships as a local Expo Module at
  `apps/client/modules/expo-lan-server/`. The Android (Kotlin /
  NanoHTTPD-WebSockets) side is implemented; the iOS (Swift) side
  is a skeleton that throws. The module is **not auto-linked** into
  the published bundle, so the lobby's "Host LAN match" flow on the
  web build / Play Store APK stays in its "needs dev client"
  fallback. Activation path is documented in
  `apps/client/modules/expo-lan-server/README.md`.

## Android APK

Every CI run on `main` (and on PRs touching `apps/client/`)
produces a debug-signed APK via `eas build --local` on the GitHub
Actions runner and uploads it as the `client-apk-debug` workflow
artifact. Download from the run summary page — it expires after
14 days.

The local-EAS flow runs entirely on the GitHub runner — no EAS
cloud minutes / paid plan needed. The `EXPO_TOKEN` repo secret is
required for CLI authentication only; nothing actually flows
through Expo's build infrastructure.

To install on a device, enable "Install unknown apps" for your
browser/file manager, transfer the APK, and tap to install. For
production / Play Store releases you'll need to add a release-
signing keystore and switch to the `production-apk` (or
`production` app-bundle) profile in `apps/client/eas.json` —
configured but not wired into the workflow until release time.

## iOS

Deferred. iOS builds need a `macos-latest` runner + Apple
Developer signing certs; the EAS local build flow we use for
Android works on macOS too, but it's unwired in the current
workflow. Until then, iOS dev is local-only via
`pnpm --filter @mahjong/client ios` (Xcode required).

## Rolling back a bad deploy

To roll back to a previous green deploy without reverting code:

1. **Cloudflare Pages dashboard → modern-mahjong → Deployments** → find a known-good deploy → "Rollback to this deployment".
2. The page root URL flips back to the rollback target within ~30 s.
3. After diagnosing, fix forward on a new branch and re-deploy.

The Vite-era artifacts (everything before #80) are still in the deployment history if a deeper rollback is ever needed.

## Why these tools

- **Cloudflare Pages** for the client: free, edge-cached, deploys
  from GitHub in ~30s, gives you `https://` for free (needed for
  camera APIs in the future).
- **Cloudflare Workers + Durable Objects** for the server:
  partyserver is built on DOs; the same code works locally
  (`wrangler dev`) and in production with no rewrites. Each match
  code maps 1:1 to a single-threaded DO, which is what makes
  claim resolution race-condition-proof. The migration didn't
  touch the server.
- **GitHub-hosted runners + EAS local** for the Android APK: no
  Android Studio needed locally; `setup-java` + EAS CLI + Gradle
  do everything in a clean `ubuntu-latest` runner. APKs are
  reproducible from the source tree alone. Replaces the previous
  Capacitor + `npx cap add android` + `assembleDebug` flow.
