import {
  HONORS,
  type Honor,
  type Tile as MTile,
  RANKS,
  SUITS,
  type Suit,
  type SuitRank,
} from '@mahjong/game-logic';
import { INK_2, INK_3, PAPER } from '../../native/theme.js';
import { Tile } from '../Tile.js';

interface TileGroup {
  title: string;
  info: string;
  tiles: MTile[];
}

const ALL_FACES: MTile[] = (() => {
  const out: MTile[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      out.push({ kind: 'suit', suit, rank: rank as SuitRank, copy: 0 });
    }
  }
  for (const honor of HONORS) {
    out.push({ kind: 'honor', honor: honor as Honor, copy: 0 });
  }
  return out;
})();

const SUIT_LABEL: Record<Suit, { title: string; info: string }> = {
  man: { title: 'Characters · 萬子 (Man)', info: '36 tiles · 9 unique × 4' },
  pin: { title: 'Dots · 筒子 (Pin)', info: '36 tiles · 9 unique × 4' },
  sou: { title: 'Bamboo · 索子 (Sou)', info: '36 tiles · 9 unique × 4' },
};

/**
 * 136-tile reference grouped by suit. Rendered below the settings grid in
 * `SettingsPanel`. Each row groups tiles by face (man / pin / sou / winds /
 * dragons), labels the count, and renders one of each unique face at 42×58.
 *
 * The settings UI and this reference are independent concerns, so the
 * reference lives in its own file rather than crowding `SettingsPanel`.
 */
export function TileReference() {
  const groups: TileGroup[] = [
    ...SUITS.map((s) => ({
      ...SUIT_LABEL[s],
      tiles: ALL_FACES.filter((t) => t.kind === 'suit' && t.suit === s),
    })),
    {
      title: 'Winds · 風牌',
      info: '16 tiles · 4 winds × 4',
      tiles: ALL_FACES.filter((t) => t.kind === 'honor' && 'ESWN'.includes(t.honor)),
    },
    {
      title: 'Dragons · 三元牌',
      info: '12 tiles · 3 dragons × 4',
      tiles: ALL_FACES.filter((t) => t.kind === 'honor' && 'ZFB'.includes(t.honor)),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {groups.map((g) => (
        <div key={g.title}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
            <div style={{ fontWeight: 900, fontSize: 14, color: INK_2 }}>{g.title}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: INK_3 }}>{g.info}</div>
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              padding: 14,
              background: PAPER,
              borderRadius: 14,
            }}
          >
            {g.tiles.map((t) => (
              <div
                key={tileKey(t)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  ['--tile-w' as string]: '42px',
                  ['--tile-h' as string]: '58px',
                }}
              >
                <Tile tile={t} />
                <div style={{ fontSize: 9, fontWeight: 700, color: INK_3 }}>×4</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function tileKey(t: MTile): string {
  if (t.kind === 'suit') return `${t.suit}-${t.rank}`;
  return `honor-${t.honor}`;
}
