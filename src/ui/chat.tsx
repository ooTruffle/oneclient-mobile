import { Ionicons } from '@expo/vector-icons';
import { useMemo, useRef, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  Text,
  ScrollView,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MAX_MESSAGE_LENGTH } from '@/config';
import { isJumboEmoji, renderEmoji, searchEmoji, shortcodeAtCursor } from '@/lib/emoji';
import { clockTime } from '@/lib/format';
import { Avatar, ripple } from './components';
import { makeStyles, radius, spacing, type, useTheme, withAlpha } from './theme';

export interface ChatMessage {
  id: number;
  sender: string;
  content: string;
  sent_at: string;
  edited_at?: string | null;
  inviteStatus?: string | null;
  /** Only on our own messages that the server hasn't confirmed yet. */
  status?: 'sending' | 'failed';
}

/** Newest-first list rendered inverted, so it sticks to the bottom like a chat. */
export function MessageList({
  messages,
  me,
  name,
  showSenders,
  onPress,
  onLongPress,
  onLoadOlder,
  loadingOlder,
  empty,
}: {
  messages: ChatMessage[];
  me: string;
  name: (id: string) => string;
  showSenders: boolean;
  onPress?: (message: ChatMessage) => void;
  onLongPress?: (message: ChatMessage) => void;
  onLoadOlder?: () => void;
  loadingOlder?: boolean;
  empty?: ReactElement;
}) {
  const c = useTheme();
  return (
    <FlatList
      inverted
      data={messages}
      keyExtractor={(m) => String(m.id)}
      contentContainerStyle={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}
      onEndReached={onLoadOlder}
      onEndReachedThreshold={0.3}
      ListFooterComponent={loadingOlder ? <ActivityIndicator style={{ margin: spacing.md }} color={c.primary} /> : null}
      // The list applies its own inversion transform to the empty view (scale -1 on
      // Android, scaleY -1 elsewhere), so it must not be counter-flipped here.
      ListEmptyComponent={empty ?? null}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      renderItem={({ item, index }) => {
        const mine = item.sender.toLowerCase() === me.toLowerCase();
        // In an inverted list the "previous" (older) message is index + 1.
        const older = messages[index + 1];
        const firstOfRun = !older || older.sender !== item.sender;
        return (
          <MessageBubble
            message={item}
            mine={mine}
            senderName={showSenders && !mine && firstOfRun ? name(item.sender) : undefined}
            showAvatar={!mine && firstOfRun}
            onPress={onPress ? () => onPress(item) : undefined}
            onLongPress={onLongPress ? () => onLongPress(item) : undefined}
          />
        );
      }}
    />
  );
}

function MessageBubble({
  message,
  mine,
  senderName,
  showAvatar,
  onPress,
  onLongPress,
}: {
  message: ChatMessage;
  mine: boolean;
  senderName?: string;
  showAvatar: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const c = useTheme();
  const styles = useStyles();
  const isInvite = message.inviteStatus != null;
  const failed = message.status === 'failed';
  const shown = renderEmoji(message.content);
  return (
    <View style={[styles.line, mine ? styles.lineMine : styles.lineTheirs, showAvatar && { marginTop: spacing.sm }]}>
      {!mine && <View style={{ width: 28 }}>{showAvatar && <Avatar uuid={message.sender} size={28} />}</View>}
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        style={[
          styles.bubble,
          mine ? styles.bubbleMine : styles.bubbleTheirs,
          message.status === 'sending' && { opacity: 0.6 },
          failed && styles.bubbleFailed,
        ]}
      >
        {senderName && <Text style={styles.sender}>{senderName}</Text>}
        {isInvite ? (
          <View style={styles.invite}>
            <Ionicons name="game-controller" size={16} color={mine ? c.onPrimary : c.primary} />
            <Text style={[styles.text, mine && styles.textMine]}>
              World invite · {message.inviteStatus}
              {'\n'}
              <Text style={styles.inviteHint}>Join from OneClient on your computer.</Text>
            </Text>
          </View>
        ) : (
          <Text
            style={[
              styles.text,
              mine && styles.textMine,
              failed && { color: c.onErrorContainer },
              isJumboEmoji(shown) && styles.jumbo,
            ]}
          >
            {shown}
          </Text>
        )}
        {failed ? (
          <View style={styles.metaRow}>
            <Ionicons name="alert-circle" size={13} color={c.onErrorContainer} />
            <Text style={[styles.meta, styles.metaFailed]}>Not sent · tap to retry</Text>
          </View>
        ) : message.status === 'sending' ? (
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={12} color={withAlpha(c.onPrimary, 0.7)} />
            <Text style={[styles.meta, styles.metaMine, { marginTop: 0 }]}>Sending</Text>
          </View>
        ) : (
          <Text style={[styles.meta, mine && styles.metaMine]}>
            {clockTime(message.sent_at)}
            {message.edited_at ? ' · edited' : ''}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

/**
 * A small system line inside the conversation, e.g. "No messages yet". Used as the
 * list's empty view, so it disappears by itself once the first message lands.
 */
export function ChatNotice({ text, style }: { text: string; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return (
    <View style={[styles.notice, style]}>
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  );
}

export function Composer({
  onSend,
  placeholder = 'Message',
  editing,
  onCancelEdit,
  initialText = '',
}: {
  onSend: (text: string) => Promise<void>;
  placeholder?: string;
  editing?: boolean;
  onCancelEdit?: () => void;
  initialText?: string;
}) {
  const insets = useSafeAreaInsets();
  const c = useTheme();
  const styles = useStyles();
  const [text, setText] = useState(initialText);
  const [sending, setSending] = useState(false);
  const trimmed = text.trim();
  // Cursor position, for shortcode autocomplete.
  const [cursor, setCursor] = useState(initialText.length);
  const input = useRef<TextInput>(null);
  // Set once after picking a suggestion, to put the cursor after the emoji.
  const [forcedSelection, setForcedSelection] = useState<{ start: number; end: number } | undefined>();
  const typing = shortcodeAtCursor(text, cursor);
  const suggestions = useMemo(() => (typing ? searchEmoji(typing.query) : []), [typing?.query]);

  const pick = (emoji: string) => {
    if (!typing) return;
    const before = text.slice(0, typing.start);
    const after = text.slice(cursor);
    const insert = after.startsWith(' ') ? emoji : `${emoji} `;
    const next = before + insert + after;
    const at = before.length + insert.length;
    setText(next);
    setCursor(at);
    setForcedSelection({ start: at, end: at });
    input.current?.focus(); // keep typing straight away
  };

  const send = async () => {
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await onSend(trimmed);
      setText('');
      setCursor(0);
    } catch {
      // The screen surfaces the error; keep the draft so it can be retried.
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      {editing && (
        <View style={styles.editing}>
          <Ionicons name="create-outline" size={18} color={c.primary} />
          <Text style={styles.editingText}>Editing message</Text>
          <Pressable onPress={onCancelEdit} hitSlop={8} accessibilityLabel="Cancel edit">
            <Ionicons name="close" size={20} color={c.onSurfaceVariant} />
          </Pressable>
        </View>
      )}
      {suggestions.length > 0 && (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          style={styles.suggestions}
          contentContainerStyle={styles.suggestionsContent}
          accessibilityLabel="Emoji suggestions"
        >
          {suggestions.map((s) => (
            <Pressable
              key={s.name}
              onPress={() => pick(s.emoji)}
              accessibilityRole="button"
              accessibilityLabel={`Insert ${s.name.replace(/_/g, ' ')}`}
              android_ripple={ripple(c.onSurface)}
              style={({ pressed }) => [
                styles.suggestion,
                pressed && Platform.OS !== 'android' && { backgroundColor: withAlpha(c.onSurface, 0.08) },
              ]}
            >
              <Text style={styles.suggestionEmoji}>{s.emoji}</Text>
              <Text style={styles.suggestionName} numberOfLines={1}>
                :{s.name}:
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <View style={styles.composer}>
        <TextInput
          ref={input}
          value={text}
          onChangeText={(next) => {
            // Typing at the end keeps the cursor at the end. Some platforms (web)
            // don't report selection changes while typing; elsewhere the
            // selection event right after corrects this for edits mid-text.
            setCursor((at) => (at >= text.length ? next.length : at));
            setText(next);
          }}
          onSelectionChange={(e) => {
            setCursor(e.nativeEvent.selection.end);
            if (forcedSelection) setForcedSelection(undefined);
          }}
          selection={forcedSelection}
          placeholder={placeholder}
          placeholderTextColor={c.onSurfaceVariant}
          selectionColor={c.primary}
          cursorColor={c.primary}
          multiline
          maxLength={MAX_MESSAGE_LENGTH}
          style={styles.input}
        />
        <Pressable
          accessibilityLabel={editing ? 'Save edit' : 'Send'}
          onPress={send}
          disabled={!trimmed || sending}
          style={[
            styles.send,
            !trimmed && !sending && { backgroundColor: withAlpha(c.onSurface, 0.12) },
          ]}
        >
          {sending ? (
            <ActivityIndicator color={c.onPrimary} size="small" />
          ) : (
            <Ionicons
              name={editing ? 'checkmark' : 'send'}
              size={20}
              color={trimmed ? c.onPrimary : withAlpha(c.onSurface, 0.38)}
            />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  line: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: 2 },
  lineMine: { justifyContent: 'flex-end' },
  lineTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', paddingHorizontal: spacing.md + 2, paddingVertical: spacing.sm, borderRadius: 20 },
  bubbleMine: { backgroundColor: c.primary, borderBottomRightRadius: radius.xs },
  bubbleTheirs: { backgroundColor: c.surfaceContainerHigh, borderBottomLeftRadius: radius.xs },
  bubbleFailed: { backgroundColor: c.errorContainer },
  sender: { ...type.labelMedium, color: c.primary, marginBottom: 2 },
  text: { color: c.onSurface, ...type.bodyLarge, letterSpacing: 0.15, lineHeight: 22 },
  textMine: { color: c.onPrimary },
  jumbo: { fontSize: 36, lineHeight: 44 },
  meta: { color: c.onSurfaceVariant, ...type.labelSmall, fontWeight: '400', marginTop: 2, alignSelf: 'flex-end' },
  metaMine: { color: withAlpha(c.onPrimary, 0.7) },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end', marginTop: 2 },
  metaFailed: { color: c.onErrorContainer, fontWeight: '500', marginTop: 0 },
  notice: {
    alignSelf: 'center',
    backgroundColor: c.surfaceContainerHigh,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    marginVertical: spacing.md,
  },
  noticeText: { color: c.onSurfaceVariant, ...type.bodySmall, textAlign: 'center' },
  invite: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  inviteHint: { ...type.bodySmall, opacity: 0.8 },
  composerWrap: {
    backgroundColor: c.surfaceContainer,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  editing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.sm, paddingHorizontal: spacing.xs },
  editingText: { color: c.onSurfaceVariant, ...type.labelLarge, flex: 1 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  // Shortcode autocomplete: a row of M3 suggestion chips above the input.
  suggestions: { marginHorizontal: -spacing.md, marginBottom: spacing.sm, flexGrow: 0 },
  suggestionsContent: { paddingHorizontal: spacing.md, gap: spacing.sm },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: c.outlineVariant,
    backgroundColor: c.surfaceContainerLow,
    overflow: 'hidden',
    maxWidth: 220,
  },
  suggestionEmoji: { fontSize: 20, lineHeight: 24 },
  suggestionName: { color: c.onSurfaceVariant, ...type.labelLarge, flexShrink: 1 },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 48,
    backgroundColor: c.surfaceContainerHighest,
    borderRadius: 24,
    paddingHorizontal: spacing.lg + 4,
    paddingTop: 13,
    paddingBottom: 13,
    color: c.onSurface,
    ...type.bodyLarge,
    lineHeight: undefined,
  },
  send: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
