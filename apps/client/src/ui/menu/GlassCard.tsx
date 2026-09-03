import { type ReactNode, useState } from 'react';
import { View, type ViewStyle } from 'react-native';
import { HOVER_TRANSITION, glass } from './theme';

interface GlassCardProps {
  children: ReactNode;
  quiet?: boolean;
  radius?: number;
  /** Lift 2 px + brighten on pointer hover (web). Default on. */
  hover?: boolean;
  style?: ViewStyle | undefined;
  testID?: string | undefined;
}

/**
 * Glass panel container with the hover lift from the visual language
 * (translateY −2 px + brightness 1.05 over 160 ms). Pointer-enter /
 * leave are React Native pointer events, forwarded to the DOM by
 * RN-web and inert on native.
 */
export function GlassCard({
  children,
  quiet = false,
  radius = 16,
  hover = true,
  style,
  testID,
}: GlassCardProps) {
  const [hovered, setHovered] = useState(false);
  const lifted = hover && hovered;
  return (
    <View
      testID={testID}
      onPointerEnter={hover ? () => setHovered(true) : undefined}
      onPointerLeave={hover ? () => setHovered(false) : undefined}
      style={{
        ...glass({ quiet, radius }),
        ...HOVER_TRANSITION,
        transform: [{ translateY: lifted ? -2 : 0 }],
        ...(lifted ? { filter: 'brightness(1.05)' } : {}),
        ...style,
      }}
    >
      {children}
    </View>
  );
}
