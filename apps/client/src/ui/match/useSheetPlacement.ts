import { useWindowDimensions } from 'react-native';
import { type SheetPlacement, sheetPlacementFor } from './sheetLayout';

/**
 * Where an in-match sheet sits for the live viewport: a bottom sheet on
 * phones, a centred glass panel on desktop-class viewports
 * (`sheetPlacementFor`). Read at render so a window drag across the
 * breakpoint re-places an open sheet.
 */
export function useSheetPlacement(): SheetPlacement {
  const { width, height } = useWindowDimensions();
  return sheetPlacementFor(width, height);
}
