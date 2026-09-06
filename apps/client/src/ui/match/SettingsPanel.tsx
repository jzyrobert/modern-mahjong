import { type ReactNode, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  type FeltSkin,
  type QualityChoice,
  type RendererChoice,
  type TileBackSkin,
  type UserSettings,
  useGame,
} from '../../state/game';
import { SettingsPreview3D } from '../../three/entry';
import { hasWebGL2, rendererOverride, resolveRenderer } from '../../three/renderer';
import { Modal } from '../Modal';
import { COLORS, SWITCH_TRACK } from '../colors';
import { HOVER_TRANSITION } from '../menu/theme';
import {
  CHIP_METRICS,
  QUALITY_OPTIONS,
  RENDERER_HINT,
  RENDERER_OPTIONS,
  type SegmentOption,
  chipGrid,
  chipMinWidth,
  qualityHint,
  rendererDetail,
} from './settingsOptions';
import { GLASS_SHEET } from './sheetTheme';
import { FELT_SKINS, TILE_BACK_SKINS } from './skins';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

/** Mirrors `Match.tsx`'s shell breakpoint so the sheet placement follows the shell. */
const DESKTOP_WIDTH = 768;
const DESKTOP_HEIGHT = 600;

/** Glass HUD palette — shared with the in-match sheets (`sheetTheme`). */
const G = GLASS_SHEET;

/**
 * In-match preferences panel — glass sheet (bottom on phone, right-hand
 * side sheet on desktop) with a live 3D preview on top, then the
 * renderer / quality segmented controls, felt + tile-back swatches and
 * the behaviour switches (sound, animations, discard hint, auto-record).
 *
 * Every write goes through `useGame.setSettings`, which persists to
 * localStorage; the preview re-tints from the same store slice, so what
 * the user sees up top is exactly what the table will use.
 */
export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const settings = useGame((s) => s.settings);
  const setSettings = useGame((s) => s.setSettings);
  const { width, height } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_WIDTH && height >= DESKTOP_HEIGHT;
  const webgl2 = Platform.OS === 'web' && hasWebGL2();
  const live3D = webgl2 && SettingsPreview3D !== null;
  const resolved = resolveRenderer(settings.renderer);
  const override = rendererOverride();
  // Landscape phones: the sheet is short, so the stage trades section
  // gap for height (170 px + a 2.3:1 fov cap in `previewConfig`).
  const shortSheet = height < 520;
  const previewHeight = shortSheet ? 170 : isDesktop ? 236 : 206;

  return (
    <Modal
      open={open}
      title="Settings"
      onClose={onClose}
      variant="glass"
      placement={isDesktop ? 'right' : 'bottom'}
      maxWidth={isDesktop ? 440 : 600}
    >
      <ScrollView
        testID="settings-panel"
        contentContainerStyle={{
          padding: isDesktop ? 18 : 14,
          paddingBottom: 28,
          gap: shortSheet ? 16 : 22,
        }}
      >
        {live3D && SettingsPreview3D ? (
          <SettingsPreview3D
            felt={settings.felt}
            tileBack={settings.tileBack}
            height={previewHeight}
          />
        ) : (
          <StaticPreview felt={settings.felt} tileBack={settings.tileBack} />
        )}

        <Section
          label="Renderer"
          trailing={
            <StatusPill
              tone={resolved === '3d' ? 'gold' : 'neutral'}
              label={resolved === '3d' ? '3D active' : 'Classic active'}
            />
          }
        >
          <Segmented<RendererChoice>
            options={RENDERER_OPTIONS}
            value={settings.renderer}
            onChange={(renderer) => setSettings({ renderer })}
            testIDPrefix="renderer"
            groupLabel="Renderer"
            compact={isDesktop}
          />
          <Hint>{RENDERER_HINT}</Hint>
          <Hint muted>{rendererDetail(settings.renderer, webgl2, override)}</Hint>
        </Section>

        <Section label="Quality">
          <Segmented<QualityChoice>
            options={QUALITY_OPTIONS}
            value={settings.quality}
            onChange={(quality) => setSettings({ quality })}
            testIDPrefix="quality"
            groupLabel="Quality"
            compact={isDesktop}
          />
          <Hint>{qualityHint(settings.quality)}</Hint>
        </Section>

        <Section label="Felt">
          <SkinChipRow
            skins={FELT_SKINS}
            value={settings.felt}
            onChange={(felt) => setSettings({ felt })}
            groupLabel="Felt skin"
            testIDPrefix="felt"
            swatch={{ width: 30, height: 30, radius: 15 }}
          />
        </Section>

        <Section label="Tile back">
          <SkinChipRow
            skins={TILE_BACK_SKINS}
            value={settings.tileBack}
            onChange={(tileBack) => setSettings({ tileBack })}
            groupLabel="Tile back skin"
            testIDPrefix="tileback"
            swatch={{ width: 22, height: 30, radius: 5 }}
          />
        </Section>

        <Section label="Behaviour">
          <Card>
            <ToggleRow
              label="Sound effects"
              hint="Tile clack on discards + claims, dice roll, between-hand shuffle."
              value={settings.sound}
              onChange={(sound) => setSettings({ sound })}
              testID="toggle-sound"
            />
            <Divider />
            <ToggleRow
              label="Animations"
              hint="Override the OS reduced-motion preference."
              value={settings.animations}
              onChange={(animations) => setSettings({ animations })}
              testID="toggle-animations"
            />
            <Divider />
            <ToggleRow
              label="Discard hint"
              hint="Highlight the heuristic ranker's recommended discard on your turn."
              value={settings.discardHint}
              onChange={(discardHint) => setSettings({ discardHint })}
              testID="toggle-discard-hint"
            />
            <Divider />
            <ToggleRow
              label="Auto-record replays"
              hint={`Every match saves to your replay library (keeps the last ${settings.replayQuota}).`}
              value={settings.autoRecordReplays}
              onChange={(autoRecordReplays) => setSettings({ autoRecordReplays })}
              testID="toggle-auto-record"
            />
          </Card>
        </Section>
      </ScrollView>
    </Modal>
  );
}

function Section({
  label,
  trailing,
  children,
}: { label: string; trailing?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text
          style={{
            fontSize: 11,
            fontWeight: '700',
            color: G.text3,
            letterSpacing: 2,
            textTransform: 'uppercase',
          }}
        >
          {label}
        </Text>
        {trailing}
      </View>
      {children}
    </View>
  );
}

function StatusPill({ label, tone }: { label: string; tone: 'gold' | 'neutral' }) {
  const gold = tone === 'gold';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 9,
        paddingVertical: 3,
        borderRadius: 999,
        backgroundColor: gold ? G.goldTint : G.surface,
        borderWidth: 1,
        borderColor: gold ? 'rgba(216,168,90,0.45)' : G.border,
      }}
    >
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: gold ? G.gold : 'rgba(255,255,255,0.5)',
        }}
      />
      <Text
        style={{
          fontSize: 11,
          lineHeight: 13,
          fontWeight: '700',
          letterSpacing: 2,
          textTransform: 'uppercase',
          color: gold ? G.gold : G.text2,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function Hint({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <Text
      style={{ fontSize: 12, lineHeight: 17, color: muted ? G.text3 : G.text2, fontWeight: '500' }}
    >
      {children}
    </Text>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderWidth: 1,
        borderColor: G.hairline,
        paddingHorizontal: 14,
        paddingVertical: 2,
      }}
    >
      {children}
    </View>
  );
}

function Divider() {
  return <View style={{ height: 1, backgroundColor: G.hairline }} />;
}

interface SegmentedProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  testIDPrefix: string;
  groupLabel: string;
  /** Pointer-driven layouts can drop to 38 px; touch keeps the 44 px minimum. */
  compact?: boolean;
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  testIDPrefix,
  groupLabel,
  compact = false,
}: SegmentedProps<T>) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={groupLabel}
      style={{
        flexDirection: 'row',
        padding: 3,
        gap: 3,
        borderRadius: 12,
        backgroundColor: G.surface,
        borderWidth: 1,
        borderColor: G.hairline,
      }}
    >
      {options.map((o) => (
        <Segment
          key={o.value}
          option={o}
          selected={o.value === value}
          onPress={() => onChange(o.value)}
          groupLabel={groupLabel}
          testID={`${testIDPrefix}-${o.value}`}
          compact={compact}
        />
      ))}
    </View>
  );
}

/**
 * Pointer hover (RN-web `onHoverIn/Out`): 1 px lift + brightness 1.05
 * over 160 ms, per the HUD language. Inert on touch / native.
 */
function useHoverLift(): {
  hovered: boolean;
  hoverProps: { onHoverIn: () => void; onHoverOut: () => void };
  hoverStyle: (pressed: boolean) => Record<string, unknown>;
} {
  const [hovered, setHovered] = useState(false);
  const lifted = hovered ? (pressed: boolean) => !pressed : () => false;
  return {
    hovered,
    hoverProps: { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) },
    hoverStyle: (pressed: boolean) => ({
      ...HOVER_TRANSITION,
      transform: [{ translateY: lifted(pressed) ? -1 : 0 }, { scale: pressed ? 0.97 : 1 }],
      ...(lifted(pressed) ? { filter: 'brightness(1.05)' } : {}),
    }),
  };
}

function Segment<T extends string>({
  option: o,
  selected,
  onPress,
  groupLabel,
  testID,
  compact,
}: {
  option: SegmentOption<T>;
  selected: boolean;
  onPress: () => void;
  groupLabel: string;
  testID: string;
  compact: boolean;
}) {
  const { hovered, hoverProps, hoverStyle } = useHoverLift();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={`${groupLabel}: ${o.label}`}
      accessibilityState={{ selected, checked: selected }}
      aria-checked={selected}
      testID={testID}
      {...hoverProps}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: compact ? 38 : 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 9,
        backgroundColor: selected ? G.gold : pressed || hovered ? G.surfaceHi : 'transparent',
        ...hoverStyle(pressed),
      })}
    >
      <Text
        style={{
          fontSize: 13,
          fontWeight: selected ? '800' : '600',
          color: selected ? G.goldInk : 'rgba(255,255,255,0.78)',
          letterSpacing: 0.2,
        }}
      >
        {o.label}
      </Text>
    </Pressable>
  );
}

interface ChipProps {
  name: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  testID: string;
  swatch: ReactNode;
  /** Measured chip width from `chipGrid`; `undefined` before the row
   *  has laid out, when the pill sizes itself from its content. */
  width: number | undefined;
}

function SkinChip({
  name,
  selected,
  onPress,
  accessibilityLabel,
  testID,
  swatch,
  width,
}: ChipProps) {
  const { hoverProps, hoverStyle } = useHoverLift();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected, checked: selected }}
      aria-checked={selected}
      testID={testID}
      {...hoverProps}
      style={({ pressed }) => ({
        // Sized by the row's measured grid, never by a fixed share of
        // the row: the pill is always at least as wide as its label.
        ...(width !== undefined ? { width } : { flexGrow: 0 }),
        flexDirection: 'row',
        alignItems: 'center',
        gap: CHIP_METRICS.gap,
        paddingVertical: 6,
        paddingLeft: CHIP_METRICS.padLeft,
        paddingRight: CHIP_METRICS.padRight,
        borderRadius: 999,
        minHeight: 44,
        borderWidth: CHIP_METRICS.border,
        borderColor: selected ? G.gold : pressed ? G.surfaceHi : G.border,
        backgroundColor: selected ? G.goldTint : pressed ? G.surfaceHi : G.surface,
        ...hoverStyle(pressed),
      })}
    >
      {swatch}
      <Text
        numberOfLines={1}
        style={{
          fontSize: 13,
          fontWeight: '700',
          flexShrink: 1,
          color: selected ? G.text : 'rgba(255,255,255,0.78)',
        }}
      >
        {name}
      </Text>
    </Pressable>
  );
}

/** Two-tone swatch: top colour with the bottom stop bleeding up from below. */
function Swatch({
  top,
  bottom,
  width,
  height,
  radius,
}: { top: string; bottom: string; width: number; height: number; radius: number }) {
  return (
    <View
      style={{
        width,
        height,
        borderRadius: radius,
        backgroundColor: top,
        overflow: 'hidden',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25), 0 2px 6px rgba(0,0,0,0.35)',
      }}
    >
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: height * 0.55,
          backgroundColor: bottom,
          opacity: 0.85,
          borderBottomLeftRadius: radius,
          borderBottomRightRadius: radius,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: height * 0.38,
          height: height * 0.2,
          backgroundColor: bottom,
          opacity: 0.4,
        }}
      />
    </View>
  );
}

interface SkinChipRowProps<K extends string> {
  skins: Record<K, { name: string; top: string; bottom: string }>;
  value: K;
  onChange: (v: K) => void;
  groupLabel: string;
  testIDPrefix: string;
  swatch: { width: number; height: number; radius: number };
}

const CHIP_ROW_GAP = 8;

/**
 * Wrapped row of skin chips laid out on a measured grid: `chipGrid`
 * picks the column count from the row's width and the widest label
 * (`chipMinWidth`), so every pill holds its text with the full padding
 * and the rows stay even (2 × 2 on phones, one row of four on wide
 * sheets). The first frame — before `onLayout` — sizes pills from
 * their content.
 */
function SkinChipRow<K extends string>({
  skins,
  value,
  onChange,
  groupLabel,
  testIDPrefix,
  swatch,
}: SkinChipRowProps<K>) {
  const [rowWidth, setRowWidth] = useState(0);
  const ids = Object.keys(skins) as K[];
  const minChip = chipMinWidth(
    ids.map((id) => skins[id].name),
    { ...CHIP_METRICS, swatchWidth: swatch.width },
  );
  const { columns, chipWidth } = chipGrid(rowWidth, ids.length, minChip, CHIP_ROW_GAP);
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={groupLabel}
      onLayout={(e) => setRowWidth(Math.floor(e.nativeEvent.layout.width))}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: CHIP_ROW_GAP }}
    >
      {ids.map((id) => {
        const skin = skins[id];
        return (
          <SkinChip
            key={id}
            name={skin.name}
            selected={value === id}
            onPress={() => onChange(id)}
            accessibilityLabel={`${groupLabel}: ${skin.name}`}
            testID={`${testIDPrefix}-${id}`}
            width={columns > 0 ? chipWidth : undefined}
            swatch={
              <Swatch
                top={skin.top}
                bottom={skin.bottom}
                width={swatch.width}
                height={swatch.height}
                radius={swatch.radius}
              />
            }
          />
        );
      })}
    </View>
  );
}

interface ToggleRowProps {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
  testID: string;
}

/**
 * Label column + switch. Keep the shape (row → [column → label, hint],
 * switch): `discard-hint.spec.ts` walks `../..` from the label text to
 * find the row's checkbox.
 */
function ToggleRow({ label, hint, value, onChange, testID }: ToggleRowProps) {
  return (
    <View
      testID={testID}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 11 }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: G.text }}>{label}</Text>
        <Text style={{ fontSize: 12, lineHeight: 16, color: G.text2, fontWeight: '500' }}>
          {hint}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        accessibilityState={{ checked: value }}
        trackColor={{ true: SWITCH_TRACK.true, false: 'rgba(255,255,255,0.22)' }}
        thumbColor="#ffffff"
        ios_backgroundColor="rgba(255,255,255,0.22)"
      />
    </View>
  );
}

/**
 * No-WebGL / native fallback for the live preview — the same felt,
 * rail and three tiles, drawn flat.
 */
function StaticPreview({ felt, tileBack }: { felt: FeltSkin; tileBack: TileBackSkin }) {
  const f = FELT_SKINS[felt];
  const b = TILE_BACK_SKINS[tileBack];
  const tile = (child: ReactNode, back = false) => (
    <View
      style={{
        width: 40,
        height: 54,
        borderRadius: 6,
        backgroundColor: back ? b.top : '#f5efe0',
        borderWidth: 1,
        borderColor: back ? b.bottom : '#e6dcc6',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 6px 10px rgba(0,0,0,0.35)',
      }}
    >
      {child}
    </View>
  );
  return (
    <View
      testID="settings-preview-static"
      style={{
        height: 150,
        borderRadius: 14,
        overflow: 'hidden',
        backgroundColor: '#10191a',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 14,
      }}
    >
      <View
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 18,
          backgroundColor: '#6a4026',
          padding: 8,
        }}
      >
        <View
          style={{
            flex: 1,
            borderRadius: 12,
            backgroundColor: f.top,
            borderWidth: 6,
            borderColor: f.bottom,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
          }}
        >
          {tile(
            <Text
              style={{
                fontFamily: 'Noto Serif TC',
                fontSize: 15,
                color: '#2a2418',
                lineHeight: 17,
              }}
            >
              五{'\n'}
              <Text style={{ color: '#b03220' }}>萬</Text>
            </Text>,
          )}
          {tile(
            <Text style={{ fontFamily: 'Noto Serif TC', fontSize: 22, color: '#266c40' }}>發</Text>,
          )}
          {tile(null, true)}
        </View>
      </View>
    </View>
  );
}

// Re-export for callers that just want the per-key types (used by
// `useGame.setSettings` typing).
export type { UserSettings };
