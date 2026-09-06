import { ScrollView, Text, View } from 'react-native';
import { Modal } from '../Modal';
import { COLORS } from '../colors';
import { TileReference } from './TileReference';
import { type SheetTheme, sheetPalette } from './sheetTheme';

interface TileReferenceSheetProps {
  open: boolean;
  onClose: () => void;
  /** `paper` (default) is the classic cream sheet; `glass` is the 3D
   *  HUD's dark panel with the tiles on felt-dark cards. */
  theme?: SheetTheme;
}

/**
 * Bottom-sheet wrapper around the 136-tile reference grid. Opens from
 * the match `TopBar`'s 📖 button. Anchors to the bottom of the viewport
 * via the `Modal` primitive's `placement="bottom"` so on portrait phones
 * the user's thumb naturally sits near the close button without the
 * card hovering mid-screen. The reference itself scrolls if its content
 * overflows the sheet's `maxHeight`.
 */
export function TileReferenceSheet({ open, onClose, theme = 'paper' }: TileReferenceSheetProps) {
  const glass = theme === 'glass';
  const P = sheetPalette(theme);
  return (
    <Modal
      open={open}
      title="Tile reference"
      onClose={onClose}
      placement="bottom"
      maxWidth={560}
      variant={theme}
    >
      <ScrollView contentContainerStyle={{ padding: glass ? 14 : 18, paddingBottom: 28, gap: 18 }}>
        <Text
          style={{
            fontSize: glass ? 13 : 12,
            color: glass ? P.text2 : COLORS.ink3,
            fontWeight: glass ? '500' : '600',
            lineHeight: 18,
          }}
        >
          Hong Kong mahjong uses 136 tiles total — 3 suits × 9 ranks × 4 plus 7 honors × 4. Every
          tile shown below has 3 invisible siblings of the same face.
        </Text>
        <TileReference theme={theme} />
      </ScrollView>
      <View style={{ height: 8 }} />
    </Modal>
  );
}
