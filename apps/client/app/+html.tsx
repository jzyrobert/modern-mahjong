import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * Static HTML shell for the web build (Metro static export). Expo
 * Router injects this around every route's body on `expo export -p
 * web`. The runtime page in the user's browser is unaffected — this
 * only controls the pre-rendered HTML the browser parses on first
 * paint.
 *
 * The cream background here is the single load-bearing rule: without
 * it, when the mobile browser's URL bar retracts on scroll the newly-
 * exposed area at the bottom of the viewport shows the document's
 * default white through. The expo-reset stylesheet sets
 * `#root,body,html{height:100%}` but no background, so whatever's
 * behind the cream-coloured root `View` is what the browser paints
 * during URL-bar retract / overscroll. Painting html + body cream
 * matches the lobby + match outer-View colours so the seam disappears.
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
        <meta name="theme-color" content="#f1eadc" />
        <ScrollViewStyleReset />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static SSR-only stylesheet — content is a literal constant, not user-controlled, and this is the documented Expo Router pattern for injecting <head> CSS. */}
        <style dangerouslySetInnerHTML={{ __html: backgroundCss }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const backgroundCss = `
html, body { background-color: #f1eadc; }
`;
