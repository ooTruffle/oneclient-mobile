import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { avatarUrls } from '@/config';
import { useSkinTexture } from '@/state/skins';
import { makeStyles, radius, spacing, type, useTheme, withAlpha } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

const isAndroid = Platform.OS === 'android';

/** Material ripple on Android; a flat state-layer tint elsewhere. */
export function ripple(color: string, borderless = false) {
  return isAndroid ? { color: withAlpha(color, 0.12), borderless, foreground: true } : undefined;
}

export function Avatar({ uuid, size = 40, online }: { uuid: string; size?: number; online?: boolean }) {
  const c = useTheme();
  const dot = Math.max(10, size * 0.28);
  const texture = useSkinTexture(uuid);
  // Wait for Mojang's answer (usually a moment) rather than flashing a maybe-stale head.
  const sources = texture === undefined ? [] : avatarUrls(uuid, size * 2, texture);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setAttempt(0), [texture]);
  return (
    <View style={{ width: size, height: size }}>
      <Image
        key={sources[attempt] ?? 'loading'}
        source={sources[attempt] ? { uri: sources[attempt] } : undefined}
        onError={() => setAttempt((a) => (a + 1 < sources.length ? a + 1 : a))}
        style={{ width: size, height: size, borderRadius: size * 0.25, backgroundColor: c.surfaceContainerHighest }}
      />
      {online !== undefined && (
        <View
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            borderWidth: 2,
            borderColor: c.surface,
            backgroundColor: online ? c.online : c.offline,
          }}
        />
      )}
    </View>
  );
}

export function GroupAvatar({ size = 44, icon = 'people' }: { size?: number; icon?: IconName }) {
  const c = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.25,
        backgroundColor: c.primaryContainer,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={icon} size={size * 0.5} color={c.onPrimaryContainer} />
    </View>
  );
}

/**
 * M3 buttons: primary = filled, secondary = tonal, danger = tonal on the error
 * container, ghost = text button.
 */
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  style,
  compact,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}) {
  const c = useTheme();
  const styles = useStyles();
  const palette = {
    primary: { bg: c.primary, fg: c.onPrimary },
    secondary: { bg: c.secondaryContainer, fg: c.onSecondaryContainer },
    danger: { bg: c.errorContainer, fg: c.onErrorContainer },
    ghost: { bg: 'transparent', fg: c.primary },
  }[variant];
  const off = disabled && !loading;
  // M3 disabled: on-surface at 12% (container) and 38% (content).
  const bg = off ? (variant === 'ghost' ? 'transparent' : withAlpha(c.onSurface, 0.12)) : palette.bg;
  const fg = off ? withAlpha(c.onSurface, 0.38) : palette.fg;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      onPress={onPress}
      disabled={disabled || loading}
      android_ripple={ripple(palette.fg)}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        variant === 'ghost' && { paddingHorizontal: compact ? spacing.md : spacing.lg },
        { backgroundColor: bg },
        pressed && !isAndroid && { opacity: 0.88 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={18} color={fg} />}
          <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  color,
  label,
  disabled,
}: {
  icon: IconName;
  onPress: () => void;
  color?: string;
  label: string;
  disabled?: boolean;
}) {
  const c = useTheme();
  const styles = useStyles();
  const tint = color ?? c.onSurfaceVariant;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      android_ripple={ripple(tint, true)}
      style={({ pressed }) => [
        styles.iconButton,
        { opacity: disabled ? 0.38 : 1 },
        pressed && !isAndroid && { backgroundColor: withAlpha(tint, 0.12) },
      ]}
    >
      <Ionicons name={icon} size={24} color={tint} />
    </Pressable>
  );
}

/** M3 outlined text field. */
export function Field(props: TextInputProps) {
  const c = useTheme();
  const styles = useStyles();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={c.onSurfaceVariant}
      selectionColor={c.primary}
      cursorColor={c.primary}
      {...props}
      onFocus={(e) => {
        setFocused(true);
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        props.onBlur?.(e);
      }}
      style={[
        styles.field,
        focused && { borderColor: c.primary, borderWidth: 2, paddingHorizontal: spacing.lg - 1 },
        props.style,
      ]}
    />
  );
}

/** M3 switch colours on the platform switch. */
export function Toggle({
  value,
  onValueChange,
  disabled,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const c = useTheme();
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ true: c.primary, false: c.surfaceContainerHighest }}
      thumbColor={value ? c.onPrimary : c.outline}
      ios_backgroundColor={c.surfaceContainerHighest}
      // react-native-web ignores thumbColor while on and uses this instead.
      {...({ activeThumbColor: c.onPrimary } as object)}
    />
  );
}

/** M3 list item. */
export function Row({
  left,
  title,
  subtitle,
  right,
  onPress,
  onLongPress,
  bold,
  badge,
}: {
  left?: ReactNode;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  bold?: boolean;
  /** Small label after the title, e.g. "Special". */
  badge?: string;
}) {
  const c = useTheme();
  const styles = useStyles();
  const interactive = !!(onPress || onLongPress);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!interactive}
      android_ripple={interactive ? ripple(c.onSurface) : undefined}
      style={({ pressed }) => [styles.row, pressed && !isAndroid && { backgroundColor: withAlpha(c.onSurface, 0.08) }]}
    >
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text numberOfLines={1} style={[styles.rowTitle, { flexShrink: 1 }, bold && { fontWeight: '600' }]}>
            {title}
          </Text>
          {!!badge && (
            <View style={styles.rowBadge}>
              <Text style={styles.rowBadgeText}>{badge}</Text>
            </View>
          )}
        </View>
        {!!subtitle && (
          <Text numberOfLines={1} style={[styles.rowSubtitle, bold && { color: c.onSurface, fontWeight: '500' }]}>
            {subtitle}
          </Text>
        )}
      </View>
      {right}
    </Pressable>
  );
}

/** M3 list subheader. */
export function SectionHeader({ title }: { title: string }) {
  const styles = useStyles();
  return (
    <Text accessibilityRole="header" style={styles.section}>
      {title}
    </Text>
  );
}

/** Filled card that groups list items. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return <View style={[styles.card, style]}>{children}</View>;
}

export function EmptyState({ icon, title, detail }: { icon: IconName; title: string; detail?: string }) {
  const c = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={32} color={c.onSecondaryContainer} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {!!detail && <Text style={styles.emptyDetail}>{detail}</Text>}
    </View>
  );
}

export function ErrorBanner({
  message,
  onRetry,
  actionLabel = 'Retry',
}: {
  message: string;
  onRetry?: () => void;
  actionLabel?: string;
}) {
  const c = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.error}>
      <Ionicons name="alert-circle" size={20} color={c.onErrorContainer} />
      <Text style={styles.errorText}>{message}</Text>
      {onRetry && (
        <Pressable onPress={onRetry} hitSlop={8} accessibilityRole="button" style={styles.errorAction}>
          <Text style={styles.errorActionText}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** M3 assist chip showing the live connection. */
export function ConnectionPill({ connected }: { connected: boolean }) {
  const c = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.pill}>
      <View style={[styles.pillDot, { backgroundColor: connected ? c.online : c.offline }]} />
      <Text style={styles.pillText}>{connected ? 'Live' : 'Connecting'}</Text>
    </View>
  );
}

/** M3 small badge (count). */
export function Badge({ count, style }: { count: number; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return (
    <View style={[styles.badge, style]}>
      <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

/** M3 segmented buttons. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; badge?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const c = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.segmented} accessibilityRole="radiogroup">
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            android_ripple={ripple(c.onSurface)}
            style={[
              styles.segment,
              i > 0 && styles.segmentDivider,
              active && { backgroundColor: c.secondaryContainer },
            ]}
          >
            {active && <Ionicons name="checkmark" size={18} color={c.onSecondaryContainer} />}
            <Text
              numberOfLines={1}
              style={[styles.segmentText, { color: active ? c.onSecondaryContainer : c.onSurface }]}
            >
              {o.label}
            </Text>
            {!!o.badge && <Badge count={o.badge} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  buttonCompact: { minHeight: 40, paddingHorizontal: spacing.lg },
  buttonText: { ...type.labelLarge },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: {
    borderColor: c.outline,
    borderWidth: 1,
    borderRadius: radius.xs,
    paddingHorizontal: spacing.lg,
    minHeight: 48,
    paddingVertical: 12,
    color: c.onSurface,
    ...type.bodyLarge,
    lineHeight: undefined,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowTitle: { color: c.onSurface, ...type.bodyLarge, letterSpacing: 0.15 },
  rowSubtitle: { color: c.onSurfaceVariant, ...type.bodyMedium },
  rowBadge: {
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
    backgroundColor: c.tertiaryContainer,
  },
  rowBadgeText: { ...type.labelSmall, color: c.onTertiaryContainer },
  section: {
    color: c.primary,
    ...type.titleSmall,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  card: {
    backgroundColor: c.surfaceContainer,
    marginHorizontal: spacing.md,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  empty: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl * 2, gap: spacing.md },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: c.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyTitle: { color: c.onSurface, ...type.titleLarge, textAlign: 'center' },
  emptyDetail: { color: c.onSurfaceVariant, ...type.bodyMedium, textAlign: 'center' },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    margin: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: c.errorContainer,
  },
  errorText: { color: c.onErrorContainer, flex: 1, ...type.bodyMedium },
  errorAction: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  errorActionText: { color: c.onErrorContainer, ...type.labelLarge, textDecorationLine: 'underline' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: c.outlineVariant,
  },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { color: c.onSurfaceVariant, ...type.labelLarge },
  segmented: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    marginVertical: spacing.md,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: c.outline,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  segmentDivider: { borderLeftWidth: 1, borderLeftColor: c.outline },
  segmentText: { ...type.labelLarge, flexShrink: 1 },
  badge: {
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: c.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: c.onError, ...type.labelSmall, lineHeight: 14 },
}));
