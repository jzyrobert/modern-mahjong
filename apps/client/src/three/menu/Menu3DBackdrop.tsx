import { type ComponentType, useEffect, useState } from 'react';

/**
 * Zero-prop menu backdrop that fills its positioned parent. The scene
 * module (three + TilePool + atlas) is pulled in with a dynamic import
 * from an effect, so the lobby's first paint is the DOM gradient + text
 * and the WebGL canvas fades in afterwards (`MenuSceneView`).
 *
 * Web-only — `src/three/entry.tsx` exports `null` on native.
 */
export function Menu3DBackdrop() {
  const [Scene, setScene] = useState<ComponentType | null>(null);
  useEffect(() => {
    let alive = true;
    import('./MenuSceneView')
      .then((m) => {
        if (alive) setScene(() => m.MenuSceneView);
      })
      .catch((err) => {
        console.warn('Menu3DBackdrop: scene failed to load', err);
      });
    return () => {
      alive = false;
    };
  }, []);
  return Scene ? <Scene /> : null;
}
