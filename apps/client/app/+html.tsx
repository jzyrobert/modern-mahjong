import { MENU } from '@/src/ui/menu/palette';
import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * Static HTML shell for the web build (Metro static export). Expo
 * Router injects this around every route's body on `expo export -p
 * web`. The runtime page in the user's browser is unaffected — this
 * only controls the pre-rendered HTML the browser parses on first
 * paint.
 *
 * The page background here is the single load-bearing rule: without
 * it, when the mobile browser's URL bar retracts on scroll the newly-
 * exposed area at the bottom of the viewport shows the document's
 * default white through. The expo-reset stylesheet sets
 * `#root,body,html{height:100%}` but no background, so whatever's
 * behind the root `View` is what the browser paints during URL-bar
 * retract / overscroll. It is the 3D flow's void (`MENU.void0`) — the
 * web default wherever WebGL2 exists — so the seam under the lobby
 * disappears; `app/_layout.tsx` (`usePageChrome`) repaints html / body
 * and the theme-color meta to the classic cream after hydration when
 * the renderer resolves to the classic shells.
 *
 * `ScrollViewStyleReset` is the Expo-recommended <style> that lets
 * `<ScrollView>` work correctly on web (overflow: hidden on body, etc).
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta name="theme-color" content={MENU.void0} />
        <title>{SITE_TITLE}</title>
        <meta name="description" content={SITE_DESCRIPTION} />
        <link rel="canonical" href={`${SITE_URL}/`} />
        <link rel="icon" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Modern Mahjong" />
        <meta property="og:title" content={SITE_TITLE} />
        <meta property="og:description" content={SITE_DESCRIPTION} />
        <meta property="og:url" content={`${SITE_URL}/`} />
        <meta property="og:image" content={`${SITE_URL}/og-image.png`} />
        <meta name="twitter:card" content="summary_large_image" />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD built from literal constants. */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
        <ScrollViewStyleReset />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static SSR-only stylesheet — content is a literal constant, not user-controlled, and this is the documented Expo Router pattern for injecting <head> CSS. */}
        <style dangerouslySetInnerHTML={{ __html: backgroundCss }} />
      </head>
      <body>
        {children}
        <noscript>
          <h1>Modern Mahjong: play Hong Kong mahjong free online</h1>
          <p>{SITE_DESCRIPTION} Needs JavaScript to run.</p>
          <a href="/how-to-play/">How to play</a> · <a href="/scoring/">Scoring (faan) table</a>
        </noscript>
      </body>
    </html>
  );
}

/** Canonical origin: the custom domain. The `*.pages.dev` host serves the same bundle. */
const SITE_URL = 'https://mahjong.robertj.in';
const SITE_TITLE = 'Modern Mahjong: Play Hong Kong Mahjong Free Online';
const SITE_DESCRIPTION =
  'Play Hong Kong mahjong free in your browser with a 3D table. Practise against bots, learn with the tutorial, or play online with friends. No download or account.';
const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'VideoGame',
  name: 'Modern Mahjong',
  url: `${SITE_URL}/`,
  description: SITE_DESCRIPTION,
  image: `${SITE_URL}/og-image.png`,
  genre: 'Board game',
  gamePlatform: 'Web browser',
  applicationCategory: 'Game',
  playMode: ['SinglePlayer', 'MultiPlayer'],
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
}).replace(/</g, '\\u003c');

const backgroundCss = `
html, body { background-color: ${MENU.void0}; }
`;
