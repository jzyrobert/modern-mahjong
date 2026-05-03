import {
  HONORS,
  type Honor,
  type Tile as MTile,
  RANKS,
  SUITS,
  type Suit,
  type SuitRank,
} from '@mahjong/game-logic';
import { CREAM, HAIRLINE, INK, INK_2, INK_3, PAPER, PAPER_HI, SANS } from '../../native/theme.js';
import { type FeltSkin, type TileBackSkin, type UserSettings, useGame } from '../../state/game.js';
import { Tile } from '../Tile.js';
import { FELT_SKINS, TILE_BACK_SKINS } from './skins.js';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  /** When true, the turn-timer setting is editable; otherwise read-only. */
  isHost: boolean;
  /** Live turn timeout from the engine (ms). */
  turnTimeoutMs: number;
  /** Host-only callback to commit a new turn timeout — wires to setRules. */
  onTurnTimeoutChange: (ms: number) => void;
}

/**
 * Settings panel + 136-tile reference. Toggled from the in-match TopBar's
 * cog button. Ported from `/tmp/design/design/app.jsx::SettingsPanel`.
 *
 * Bindings:
 * - **Felt color skin** + **Tile back colour** → CSS-var overrides applied
 *   on the Match container; persisted via `useGame.setSettings`.
 * - **Auto-sort hand** → drives whether the SortPicker default re-applies
 *   on every fresh hand.
 * - **Animations** → in-app override of the OS `prefers-reduced-motion`,
 *   read by main.tsx's MotionConfig wrapper.
 * - **Sound** → no engine wiring yet (queued in TODO.md → "Sound effects").
 * - **Turn timer** → wires to engine via `setRules` (host-only); non-hosts
 *   see the current value as read-only.
 *
 * Below the controls is a 136-tile reference grouped by suit. Reuses the
 * new TileGlyph rendering, scaled up to 42×58px.
 */
export function SettingsPanel({
  open,
  onClose,
  isHost,
  turnTimeoutMs,
  onTurnTimeoutChange,
}: SettingsPanelProps) {
  const settings = useGame((s) => s.settings);
  const setSettings = useGame((s) => s.setSettings);

  if (!open) return null;

  return (
    <div
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'oklch(0.2 0.02 60 / 0.4)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        fontFamily: SANS,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        style={{
          width: 'min(900px, 92%)',
          maxHeight: '88vh',
          background: PAPER_HI,
          borderRadius: 24,
          boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <Header onClose={onClose} />
        <div
          style={{
            overflowY: 'auto',
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}
        >
          <SettingsGrid
            settings={settings}
            onPatch={setSettings}
            isHost={isHost}
            turnTimeoutMs={turnTimeoutMs}
            onTurnTimeoutChange={onTurnTimeoutChange}
          />
          <TileReference />
        </div>
      </div>
    </div>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        padding: '18px 24px',
        borderBottom: `1px solid ${HAIRLINE}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <div>
        <div style={{ fontWeight: 900, fontSize: 22, color: INK }}>
          Settings &amp; Tile Reference
        </div>
        <div style={{ fontSize: 12, color: INK_3, marginTop: 2 }}>
          Hong Kong Mahjong · 136 tiles · 34 unique faces × 4 copies
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: 'none',
          background: PAPER,
          cursor: 'pointer',
          fontSize: 16,
          fontWeight: 700,
          color: INK,
        }}
      >
        ✕
      </button>
    </div>
  );
}

interface SettingsGridProps {
  settings: UserSettings;
  onPatch: (p: Partial<UserSettings>) => void;
  isHost: boolean;
  turnTimeoutMs: number;
  onTurnTimeoutChange: (ms: number) => void;
}

function SettingsGrid({
  settings,
  onPatch,
  isHost,
  turnTimeoutMs,
  onTurnTimeoutChange,
}: SettingsGridProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: 16,
        padding: 16,
        background: CREAM,
        borderRadius: 16,
      }}
    >
      <SettingRow label="Felt color" hint="Table surface tone">
        <SwatchRow<FeltSkin>
          options={Object.entries(FELT_SKINS).map(([id, s]) => ({
            id: id as FeltSkin,
            name: s.name,
            background: `linear-gradient(135deg, ${s.top}, ${s.bottom})`,
            shape: 'square',
          }))}
          active={settings.felt}
          onChange={(felt) => onPatch({ felt })}
        />
      </SettingRow>
      <SettingRow label="Tile back" hint="Color on the back of unrevealed tiles">
        <SwatchRow<TileBackSkin>
          options={Object.entries(TILE_BACK_SKINS).map(([id, s]) => ({
            id: id as TileBackSkin,
            name: s.name,
            background: `linear-gradient(180deg, ${s.top}, ${s.bottom})`,
            shape: 'tile',
          }))}
          active={settings.tileBack}
          onChange={(tileBack) => onPatch({ tileBack })}
        />
      </SettingRow>
      <SettingRow label="Auto-sort hand" hint="Reorder by suit on draw">
        <Toggle on={settings.autoSort} onChange={(v) => onPatch({ autoSort: v })} />
      </SettingRow>
      <SettingRow label="Animations" hint="Tile flights + dispenser glow">
        <Toggle on={settings.animations} onChange={(v) => onPatch({ animations: v })} />
      </SettingRow>
      <SettingRow
        label="Turn timer"
        hint={isHost ? 'Seconds per turn (host only)' : `${turnTimeoutMs / 1000}s — host only`}
      >
        <select
          value={turnTimeoutMs}
          disabled={!isHost}
          onChange={(e) => onTurnTimeoutChange(Number(e.target.value))}
          style={{
            padding: '6px 10px',
            borderRadius: 8,
            border: `1px solid ${HAIRLINE}`,
            fontFamily: SANS,
            fontSize: 13,
            fontWeight: 600,
            background: 'white',
            color: INK,
            opacity: isHost ? 1 : 0.6,
          }}
        >
          <option value={10000}>10s</option>
          <option value={20000}>20s</option>
          <option value={30000}>30s</option>
          <option value={60000}>60s</option>
        </select>
      </SettingRow>
      <SettingRow label="Sound" hint="Tile clicks &amp; chimes (coming soon)">
        <Toggle on={settings.sound} onChange={(v) => onPatch({ sound: v })} />
      </SettingRow>
    </div>
  );
}

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <div>
        <div style={{ fontWeight: 800, fontSize: 13, color: INK }}>{label}</div>
        <div style={{ fontSize: 11, color: INK_3 }}>{hint}</div>
      </div>
      {children}
    </div>
  );
}

interface SwatchOption<T extends string> {
  id: T;
  name: string;
  background: string;
  shape: 'square' | 'tile';
}

function SwatchRow<T extends string>({
  options,
  active,
  onChange,
}: {
  options: SwatchOption<T>[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {options.map((o) => {
        const dimensions =
          o.shape === 'tile'
            ? { width: 28, height: 36, borderRadius: 6 }
            : { width: 36, height: 36, borderRadius: 10 };
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            title={o.name}
            aria-label={o.name}
            aria-pressed={active === o.id}
            style={{
              ...dimensions,
              border: active === o.id ? `2.5px solid ${INK_2}` : '2.5px solid transparent',
              background: o.background,
              cursor: 'pointer',
              boxShadow: o.shape === 'square' ? 'inset 0 -2px 0 rgba(0,0,0,0.1)' : 'none',
              padding: 0,
            }}
          />
        );
      })}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      style={{
        width: 44,
        height: 26,
        borderRadius: 13,
        border: 'none',
        background: on ? 'oklch(0.7 0.14 150)' : 'oklch(0.85 0.012 85)',
        position: 'relative',
        cursor: 'pointer',
        transition: 'all 200ms',
        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.1)',
        padding: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 20 : 2,
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: 'white',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
          transition: 'left 200ms',
        }}
      />
    </button>
  );
}

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

function TileReference() {
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
