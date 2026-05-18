import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTransport } from '../../net/transport-context';
import { useRecorder } from '../../replay/recorder';
import { useGame } from '../../state/game';
import { nextLesson, useTutorial } from '../../state/tutorial';
import { Modal } from '../Modal';
import { COLORS } from '../colors';
import { basicsLesson } from '../tutorial/lessons/basics';
import { EMOTES } from './ChatBar';

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
}

interface MenuRowProps {
  icon: string;
  title: string;
  hint: string;
  onPress: () => void;
  destructive?: boolean;
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
}: MenuSheetProps) {
  return (
    <Modal open={open} title="Menu" onClose={onClose} placement="bottom" maxWidth={520}>
      {/* `ScrollView` so short viewports (iPhone SE in landscape, or
          mobile portrait once Tutorial / Save-match / Auto-record rows
          stack above Leave) can still reach every row. The Modal's
          90% maxHeight already caps the sheet; the ScrollView just
          lets content beyond that height scroll instead of clipping
          Leave off the bottom. `flexGrow: 0` keeps the ScrollView
          from stealing extra height — it still hugs its content
          when everything fits. */}
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 14, gap: 8 }}>
        {onSendChat ? (
          <EmoteRow
            onSendChat={(emote) => {
              onSendChat(emote);
              onClose();
            }}
          />
        ) : null}
        <MenuRowsList
          onClose={onClose}
          onOpenSettings={onOpenSettings}
          onOpenLog={onOpenLog}
          onOpenReference={onOpenReference}
          onOpenScoring={onOpenScoring}
          onLeave={onLeave}
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
        icon="⚙"
        title="Settings"
        hint="Felt, tile back, sound, animations."
        onPress={handle(onOpenSettings)}
      />
      <MenuRow
        icon="📜"
        title="Game log"
        hint="Recent engine events for this hand."
        onPress={handle(onOpenLog)}
      />
      <MenuRow
        icon="📖"
        title="Tile reference"
        hint="All 136 tiles grouped by suit + honors."
        onPress={handle(onOpenReference)}
      />
      <MenuRow
        icon="🏆"
        title="Scoring rules"
        hint="Every fan pattern with worked example hands."
        onPress={handle(onOpenScoring)}
      />
      {showTutorialRow ? (
        <MenuRow
          icon="🎓"
          title={tutorialActive ? 'Restart tutorial' : `Tutorial: ${tutorialTarget.title}`}
          hint={
            tutorialActive
              ? 'Reset the lesson back to the welcome step.'
              : `Open the "${tutorialTarget.title}" lesson.`
          }
          onPress={handle(onRestartTutorial)}
        />
      ) : null}
      {draftActive ? (
        <MenuRow
          icon={savedThisMatch ? '✓' : '💾'}
          title={savedThisMatch ? 'Saved · tap to discard' : 'Save this match'}
          hint={
            savedThisMatch
              ? 'Stays available in /replays. Tap to stop persisting further deltas.'
              : 'Records this match to your replay library.'
          }
          onPress={onSaveMatch}
        />
      ) : null}
      <MenuRow
        icon={autoRecord ? '◉' : '○'}
        title={autoRecord ? 'Auto-record: on' : 'Auto-record: off'}
        hint={
          autoRecord
            ? 'Every match auto-saves on teardown. Tap to disable.'
            : 'Future matches save only if you tap "Save this match".'
        }
        onPress={onToggleAutoRecord}
      />
      <MenuRow
        icon="←"
        title="Leave match"
        hint="Disconnects and returns to the lobby."
        onPress={handle(onLeave)}
        destructive
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

export function MenuRow({ icon, title, hint, onPress, destructive }: MenuRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: 10,
        backgroundColor: pressed ? COLORS.creamLow : COLORS.paperHi,
        borderColor: COLORS.hairline,
        borderWidth: 1,
      })}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: destructive ? COLORS.accentSalmonSwatch : '#ede5d3',
          borderColor: destructive ? COLORS.accentSalmonEdge : COLORS.hairline,
          borderWidth: 1,
        }}
      >
        <Text style={{ fontSize: 16, color: destructive ? COLORS.red : COLORS.ink }}>{icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontSize: 14,
            fontWeight: '900',
            color: destructive ? COLORS.red : COLORS.ink,
          }}
        >
          {title}
        </Text>
        <Text style={{ fontSize: 11, color: COLORS.ink3, fontWeight: '600', marginTop: 2 }}>
          {hint}
        </Text>
      </View>
    </Pressable>
  );
}
