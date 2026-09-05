import { Pressable, ScrollView, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTransport } from '../../net/transport-context';
import { useRecorder } from '../../replay/recorder';
import { useGame } from '../../state/game';
import { nextLesson, useTutorial } from '../../state/tutorial';
import { Modal } from '../Modal';
import { COLORS } from '../colors';
import { CheckIcon, TrophyIcon, TutorialIcon } from '../menu/icons';
import { basicsLesson } from '../tutorial/lessons/basics';
import { EMOTES } from './ChatBar';
import { type SheetTheme, sheetPalette } from './sheetTheme';

export interface MenuSheetProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenLog: () => void;
  onOpenReference: () => void;
  onOpenScoring: () => void;
  onLeave: () => void;
  /** Send an emote (single emoji string) — drives the floating
   *  `<ChatBubbles>` overlay. Optional so callers that don't wire
   *  chat (e.g. older shells) can omit it; when undefined the emote
   *  row is hidden. */
  onSendChat?: ((text: string) => void) | undefined;
  /** `paper` (default) is the classic cream sheet; `glass` is the 3D
   *  HUD's dark frosted panel with inline SVG row icons. */
  theme?: SheetTheme;
}

/** Row glyph — emoji on paper, an inline stroke icon on glass. */
export type MenuIconId =
  | 'settings'
  | 'log'
  | 'reference'
  | 'scoring'
  | 'tutorial'
  | 'save'
  | 'saved'
  | 'record-on'
  | 'record-off'
  | 'leave';

const PAPER_ICON: Record<MenuIconId, string> = {
  settings: '⚙',
  log: '📜',
  reference: '📖',
  scoring: '🏆',
  tutorial: '🎓',
  save: '💾',
  saved: '✓',
  'record-on': '◉',
  'record-off': '○',
  leave: '←',
};

interface MenuRowProps {
  icon: MenuIconId;
  title: string;
  hint: string;
  onPress: () => void;
  destructive?: boolean;
  /** Optional `data-testid` for rows that scripts / specs drive
   *  directly (e.g. `open-settings`, shared with the 3D HUD). */
  testID?: string;
  theme?: SheetTheme;
}

/**
 * Bottom-sheet ☰ menu that consolidates the per-match utilities —
 * Settings / Game log / Tile reference / Leave — into one entry
 * point on the `TopBar`. Replaces the four individual icon
 * buttons that used to live there. On a 320 px iPhone SE the
 * row of icon buttons clipped Leave even with flex-wrap; collapsing
 * them into a single ☰ button frees the slot and matches the
 * design's `app-mobile.jsx` reference for the menu pane.
 *
 * Each row in the sheet calls back to `Match.tsx`'s individual
 * `setSettingsOpen` / `setLogOpen` / `setReferenceOpen` /
 * `onLeave` handlers, then immediately closes the menu so the
 * downstream sheet/modal opens cleanly.
 *
 * The row list + state subscriptions are factored into `<MenuRowsList>`
 * so the desktop `<MenuSidePanel>` can reuse the exact same content
 * inside its slide-in container without duplicating the recorder /
 * tutorial / auto-record logic.
 */
export function MenuSheet({
  open,
  onClose,
  onOpenSettings,
  onOpenLog,
  onOpenReference,
  onOpenScoring,
  onLeave,
  onSendChat,
  theme = 'paper',
}: MenuSheetProps) {
  const glass = theme === 'glass';
  return (
    <Modal
      open={open}
      title="Menu"
      onClose={onClose}
      placement="bottom"
      maxWidth={520}
      variant={theme}
    >
      {/* `ScrollView` so short viewports (iPhone SE in landscape, or
          mobile portrait once Tutorial / Save-match / Auto-record rows
          stack above Leave) can still reach every row. The Modal's
          90% maxHeight already caps the sheet; the ScrollView just
          lets content beyond that height scroll instead of clipping
          Leave off the bottom. `flexGrow: 0` keeps the ScrollView
          from stealing extra height — it still hugs its content
          when everything fits. */}
      <ScrollView
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ padding: 14, gap: glass ? 6 : 8 }}
      >
        {/* Emote row temporarily disabled — the reaction system is being
            reworked. Re-enable (or replace with the new reaction surface)
            once the redesign lands. */}
        {/*
        {onSendChat ? (
          <EmoteRow
            onSendChat={(emote) => {
              onSendChat(emote);
              onClose();
            }}
          />
        ) : null}
        */}
        <MenuRowsList
          onClose={onClose}
          onOpenSettings={onOpenSettings}
          onOpenLog={onOpenLog}
          onOpenReference={onOpenReference}
          onOpenScoring={onOpenScoring}
          onLeave={onLeave}
          theme={theme}
        />
      </ScrollView>
    </Modal>
  );
}

interface MenuRowsListProps {
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenLog: () => void;
  onOpenReference: () => void;
  onOpenScoring: () => void;
  onLeave: () => void;
  theme?: SheetTheme;
}

/**
 * Renders the menu's row list (Settings / Game log / Tile reference /
 * Scoring rules / conditional Tutorial / conditional Save / Auto-record /
 * Leave) as a fragment. No outer wrapper — the caller provides the
 * scroll container so layout (bottom-sheet vs side-panel) stays in
 * the caller's hands.
 *
 * Owns the recorder / tutorial / auto-record subscriptions so both
 * `<MenuSheet>` (mobile bottom-sheet) and `<MenuSidePanel>` (desktop
 * right-anchored panel) get the same rows without duplicating the
 * hook calls.
 */
export function MenuRowsList({
  onClose,
  onOpenSettings,
  onOpenLog,
  onOpenReference,
  onOpenScoring,
  onLeave,
  theme = 'paper',
}: MenuRowsListProps) {
  const handle = (cb: () => void) => () => {
    onClose();
    cb();
  };
  const draftActive = useRecorder((s) => s.draft !== null);
  const savedThisMatch = useRecorder((s) => s.savedThisMatch);
  const saveExplicit = useRecorder((s) => s.saveExplicit);
  const discardThisMatch = useRecorder((s) => s.discardThisMatch);
  const autoRecord = useGame((s) => s.settings.autoRecordReplays);
  const replayQuota = useGame((s) => s.settings.replayQuota);
  const setSettings = useGame((s) => s.setSettings);
  const tutorialsCompleted = useGame((s) => s.settings.tutorialsCompleted);
  const tutorialActive = useTutorial((s) => s.active !== null);
  const transport = useTransport();
  // First-time players see the row only via the lobby card so the
  // in-match menu stays uncluttered; once they're in a lesson or
  // have completed at least one, the row gives them an in-match
  // restart hatch into the next-up lesson.
  const showTutorialRow = tutorialActive || tutorialsCompleted.length > 0;
  const tutorialTarget = nextLesson(tutorialsCompleted) ?? basicsLesson;

  const onSaveMatch = () => {
    if (savedThisMatch) {
      discardThisMatch();
    } else {
      saveExplicit(replayQuota);
    }
  };
  const onToggleAutoRecord = () => {
    setSettings({ autoRecordReplays: !autoRecord });
  };
  const onRestartTutorial = () => {
    transport.joinSoloTutorial(tutorialTarget.id);
  };

  return (
    <>
      <MenuRow
        icon="settings"
        title="Settings"
        hint="Renderer, quality, felt, tile back, sound, animations."
        onPress={handle(onOpenSettings)}
        testID="open-settings"
        theme={theme}
      />
      <MenuRow
        icon="log"
        title="Game log"
        hint="Recent engine events for this hand."
        onPress={handle(onOpenLog)}
        theme={theme}
      />
      <MenuRow
        icon="reference"
        title="Tile reference"
        hint="All 136 tiles grouped by suit + honors."
        onPress={handle(onOpenReference)}
        theme={theme}
      />
      <MenuRow
        icon="scoring"
        title="Scoring rules"
        hint="Every fan pattern with worked example hands."
        onPress={handle(onOpenScoring)}
        theme={theme}
      />
      {showTutorialRow ? (
        <MenuRow
          icon="tutorial"
          title={tutorialActive ? 'Restart tutorial' : `Tutorial: ${tutorialTarget.title}`}
          hint={
            tutorialActive
              ? 'Reset the lesson back to the welcome step.'
              : `Open the "${tutorialTarget.title}" lesson.`
          }
          onPress={handle(onRestartTutorial)}
          theme={theme}
        />
      ) : null}
      {draftActive ? (
        <MenuRow
          icon={savedThisMatch ? 'saved' : 'save'}
          title={savedThisMatch ? 'Saved · tap to discard' : 'Save this match'}
          hint={
            savedThisMatch
              ? 'Stays available in /replays. Tap to stop persisting further deltas.'
              : 'Records this match to your replay library.'
          }
          onPress={onSaveMatch}
          theme={theme}
        />
      ) : null}
      <MenuRow
        icon={autoRecord ? 'record-on' : 'record-off'}
        title={autoRecord ? 'Auto-record: on' : 'Auto-record: off'}
        hint={
          autoRecord
            ? 'Every match auto-saves on teardown. Tap to disable.'
            : 'Future matches save only if you tap "Save this match".'
        }
        onPress={onToggleAutoRecord}
        theme={theme}
      />
      <MenuRow
        icon="leave"
        title="Leave match"
        hint="Disconnects and returns to the lobby."
        onPress={handle(onLeave)}
        destructive
        theme={theme}
      />
    </>
  );
}

/**
 * Six-emote row inside the menu. On the desktop shell the same
 * emotes also live in a persistent `<ChatBar>` along the bottom of
 * the felt — the menu copy is for when the user is already in the
 * menu and wants to react without closing it. Tapping an emote
 * sends it and closes the menu, mirroring how the other menu rows
 * behave.
 *
 * Exported so the desktop `<MenuSidePanel>` can render it above its
 * scroll area (the design pins emote outside the scrolling region
 * for the side-panel variant).
 */
export function EmoteRow({ onSendChat }: { onSendChat: (emote: string) => void }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        padding: 10,
        borderRadius: 10,
        backgroundColor: COLORS.paperHi,
        borderColor: COLORS.hairline,
        borderWidth: 1,
      }}
    >
      <Text
        style={{
          fontSize: 11,
          fontWeight: '900',
          color: COLORS.ink3,
          letterSpacing: 0.6,
          paddingRight: 4,
        }}
      >
        EMOTE
      </Text>
      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-around' }}>
        {EMOTES.map((emote) => (
          <Pressable
            key={emote}
            onPress={() => onSendChat(emote)}
            accessibilityLabel={`Send ${emote}`}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
              transform: [{ scale: pressed ? 0.92 : 1 }],
            })}
          >
            <Text style={{ fontSize: 22, lineHeight: 26 }}>{emote}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function MenuRow({
  icon,
  title,
  hint,
  onPress,
  destructive,
  testID,
  theme = 'paper',
}: MenuRowProps) {
  const glass = theme === 'glass';
  const P = sheetPalette(theme);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      testID={testID}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: glass ? 12 : 10,
        backgroundColor: glass
          ? pressed
            ? P.surfaceHi
            : P.surface
          : pressed
            ? COLORS.creamLow
            : COLORS.paperHi,
        borderColor: glass ? (destructive ? P.redBorder : P.hairline) : COLORS.hairline,
        borderWidth: 1,
      })}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: glass ? 10 : 8,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: glass
            ? destructive
              ? P.redTint
              : P.surfaceHi
            : destructive
              ? COLORS.accentSalmonSwatch
              : '#ede5d3',
          borderColor: glass
            ? destructive
              ? P.redBorder
              : P.border
            : destructive
              ? COLORS.accentSalmonEdge
              : COLORS.hairline,
          borderWidth: 1,
        }}
      >
        {glass ? (
          <MenuGlyph id={icon} color={destructive ? P.red : P.gold} />
        ) : (
          <Text style={{ fontSize: 16, color: destructive ? COLORS.red : COLORS.ink }}>
            {PAPER_ICON[icon]}
          </Text>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontSize: 14,
            fontWeight: glass ? '800' : '900',
            color: destructive ? P.red : P.text,
          }}
        >
          {title}
        </Text>
        <Text
          style={{
            fontSize: glass ? 12 : 11,
            lineHeight: glass ? 16 : undefined,
            color: glass ? P.text2 : COLORS.ink3,
            fontWeight: glass ? '500' : '600',
            marginTop: 2,
          }}
        >
          {hint}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * Inline stroke icons for the glass menu rows (asset policy: no emoji
 * inside the 3D flow). 24-unit viewBox, 2.2 stroke, painted in the
 * row's accent colour.
 */
function MenuGlyph({ id, color }: { id: MenuIconId; color: string }) {
  const size = 18;
  const stroke = { stroke: color, strokeWidth: 2.2, strokeLinecap: 'round' as const };
  switch (id) {
    case 'settings':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Circle cx={12} cy={12} r={3.4} {...stroke} />
          <Path
            d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"
            {...stroke}
          />
        </Svg>
      );
    case 'log':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Rect x={5} y={3} width={14} height={18} rx={2} {...stroke} />
          <Path d="M9 8h6M9 12h6M9 16h4" {...stroke} />
        </Svg>
      );
    case 'reference':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path
            d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z"
            {...stroke}
            strokeLinejoin="round"
          />
          <Path d="M4 19a2 2 0 0 1 2-2h13M8.5 7.5h6" {...stroke} />
        </Svg>
      );
    case 'scoring':
      return <TrophyIcon size={size} color={color} />;
    case 'tutorial':
      return <TutorialIcon size={size} color={color} />;
    case 'save':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path d="M4 4h12l4 4v12H4z" {...stroke} strokeLinejoin="round" />
          <Path d="M8 4v5h6V4M8 20v-5h8v5" {...stroke} strokeLinejoin="round" />
        </Svg>
      );
    case 'saved':
      return <CheckIcon size={size} color={color} />;
    case 'record-on':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Circle cx={12} cy={12} r={8.5} {...stroke} />
          <Circle cx={12} cy={12} r={4} fill={color} />
        </Svg>
      );
    case 'record-off':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Circle cx={12} cy={12} r={8.5} {...stroke} />
        </Svg>
      );
    case 'leave':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path d="M10 7l-5 5 5 5M5 12h10" {...stroke} strokeLinejoin="round" />
          <Path d="M15 4h4v16h-4" {...stroke} strokeLinejoin="round" />
        </Svg>
      );
  }
}
