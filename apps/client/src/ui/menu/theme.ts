import { Platform, type TextStyle, type ViewStyle } from 'react-native';

export {
  CLASSIC_PAGE_BG,
  MENU,
  type PageChrome,
  pageChrome,
} from './palette';
import { MENU } from './palette';

/** Style keys that only exist on the web (RN-web forwards them to
 *  CSS; native ignores). Returns `{}` off-web so callers can spread. */
export function webStyle(style: Record<string, unknown>): ViewStyle {
  return Platform.OS === 'web' ? (style as ViewStyle) : {};
}

export interface GlassOptions {
  quiet?: boolean;
  radius?: number;
  /** Skip the drop shadow (nested panels). */
  flat?: boolean;
}

/**
 * Glass panel recipe: translucent ink, 16px backdrop blur on web, 1px
 * hairline, soft shadow. Native has no backdrop-filter, so it uses a
 * more opaque ground to keep text legible over the gradient.
 */
export function glass({ quiet = false, radius = 16, flat = false }: GlassOptions = {}): ViewStyle {
  const web = Platform.OS === 'web';
  return {
    backgroundColor: web
      ? quiet
        ? MENU.glassQuiet
        : MENU.glassBg
      : quiet
        ? 'rgba(14,20,17,0.82)'
        : 'rgba(14,20,17,0.9)',
    borderWidth: 1,
    borderColor: MENU.hairline,
    borderRadius: radius,
    ...(flat ? {} : { boxShadow: quiet ? MENU.shadowSoft : MENU.shadow }),
    ...webStyle({
      backdropFilter: 'blur(16px) saturate(140%)',
      WebkitBackdropFilter: 'blur(16px) saturate(140%)',
    }),
  };
}

/** 160 ms transform/filter transition (web only). */
export const HOVER_TRANSITION = webStyle({
  transitionProperty: 'transform, filter, background-color, border-color',
  transitionDuration: '160ms',
  transitionTimingFunction: 'ease-out',
});

export const TYPE = {
  /** Small uppercase label — 11px / 700 / 2px tracking. */
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: MENU.text2,
  } as TextStyle,
  body: { fontSize: 13, lineHeight: 19, color: MENU.text2, fontWeight: '500' } as TextStyle,
  small: { fontSize: 11, lineHeight: 16, color: MENU.text3, fontWeight: '600' } as TextStyle,
  cardTitle: { fontSize: 17, lineHeight: 20, fontWeight: '800', color: MENU.text } as TextStyle,
  cardSubtitle: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: MENU.text2 } as TextStyle,
  serif: { fontFamily: 'Noto Serif TC', fontWeight: '700' } as TextStyle,
  mono: {
    // The app ships no mono face, so name the system stacks explicitly:
    // a bare `'JetBrains Mono'` falls back to the browser default (a
    // serif) when it isn't installed.
    fontFamily:
      Platform.OS === 'web'
        ? "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"
        : 'monospace',
  } as TextStyle,
};

/** Display heading style at a given size (≥ 28 → −0.5 tracking). */
export function heading(size: number): TextStyle {
  return {
    fontSize: size,
    lineHeight: Math.round(size * 1.02),
    fontWeight: '800',
    letterSpacing: size >= 40 ? -1 : size >= 28 ? -0.5 : -0.2,
    color: MENU.text,
  };
}
