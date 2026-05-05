import { ScrollView, Text, View } from 'react-native';
import { Modal } from '../Modal';
import { TileReference } from './TileReference';

interface TileReferenceSheetProps {
  open: boolean;
  onClose: () => void;
}

const COLORS = {
  ink3: '#918275',
};

/**
 * Bottom-sheet wrapper around the 136-tile reference grid. Opens from
 * the match `TopBar`'s 📖 button. Anchors to the bottom of the viewport
 * via the `Modal` primitive's `placement="bottom"` so on portrait phones
 * the user's thumb naturally sits near the close button without the
 * card hovering mid-screen. The reference itself scrolls if its content
 * overflows the sheet's `maxHeight`.
 */
export function TileReferenceSheet({ open, onClose }: TileReferenceSheetProps) {
  return (
    <Modal open={open} title="Tile reference" onClose={onClose} placement="bottom" maxWidth={560}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 28, gap: 18 }}>
        <Text style={{ fontSize: 12, color: COLORS.ink3, fontWeight: '600', lineHeight: 18 }}>
          Hong Kong mahjong uses 136 tiles total — 3 suits × 9 ranks × 4 plus 7 honors × 4. Every
          tile shown below has 3 invisible siblings of the same face.
        </Text>
        <TileReference />
      </ScrollView>
      <View style={{ height: 8 }} />
    </Modal>
  );
}
