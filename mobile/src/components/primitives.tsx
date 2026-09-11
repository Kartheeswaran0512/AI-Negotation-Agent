/**
 * The small set of primitives every screen is built from.
 *
 * Deliberately one file: these are twenty-line components that only exist so
 * that padding, radius and colour are decided once. Splitting them across nine
 * files would add navigation cost without adding clarity.
 */

import React, { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type RefreshControlProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { toneColors, type Tone } from '@/theme/states';
import { useTheme } from '@/theme';

/* -------------------------------------------------------------------------- */
/* Text                                                                       */
/* -------------------------------------------------------------------------- */

type TextVariant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption' | 'mono';

interface AppTextProps {
  children: ReactNode;
  variant?: TextVariant;
  muted?: boolean;
  color?: string;
  align?: TextStyle['textAlign'];
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
  selectable?: boolean;
}

export function AppText({
  children,
  variant = 'body',
  muted = false,
  color,
  align,
  numberOfLines,
  style,
  selectable,
}: AppTextProps) {
  const { colors, typography } = useTheme();
  const base = typography[variant];

  return (
    <Text
      numberOfLines={numberOfLines}
      selectable={selectable}
      style={[
        {
          fontSize: base.fontSize,
          fontWeight: base.fontWeight as TextStyle['fontWeight'],
          color: color ?? (muted ? colors.textMuted : colors.text),
          textAlign: align,
        },
        variant === 'mono' ? styles.mono : null,
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                     */
/* -------------------------------------------------------------------------- */

export function Card({
  children,
  style,
  raised = false,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  raised?: boolean;
}) {
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: raised ? colors.surfaceRaised : colors.surface,
          borderColor: colors.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.lg,
          padding: spacing.lg,
          gap: spacing.sm,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Divider() {
  const { colors, spacing } = useTheme();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: colors.border,
        marginVertical: spacing.sm,
      }}
    />
  );
}

export function Row({
  children,
  gap = 8,
  align = 'center',
  justify = 'flex-start',
  wrap = false,
  style,
}: {
  children: ReactNode;
  gap?: number;
  align?: ViewStyle['alignItems'];
  justify?: ViewStyle['justifyContent'];
  wrap?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: align,
          justifyContent: justify,
          gap,
          flexWrap: wrap ? 'wrap' : 'nowrap',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** A labelled figure, used wherever a number needs a caption above it. */
export function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: Tone;
  hint?: string;
}) {
  const { colors, spacing } = useTheme();
  const color = tone ? toneColors(tone, colors).foreground : colors.text;

  return (
    <View style={{ gap: 2, minWidth: 96, paddingVertical: spacing.xs }}>
      <AppText variant="caption" muted>
        {label}
      </AppText>
      <AppText variant="heading" color={color}>
        {value}
      </AppText>
      {hint ? (
        <AppText variant="caption" muted>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Chip                                                                       */
/* -------------------------------------------------------------------------- */

export function Chip({
  label,
  tone = 'neutral',
  icon,
}: {
  label: string;
  tone?: Tone;
  icon?: string;
}) {
  const { colors, radius, spacing } = useTheme();
  const { foreground, background } = toneColors(tone, colors);

  return (
    <View
      style={{
        backgroundColor: background,
        borderRadius: radius.pill,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs + 1,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ color: foreground, fontSize: 12, fontWeight: '700' }}>
        {icon ? `${icon} ` : ''}
        {label}
      </Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Button                                                                     */
/* -------------------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  fullWidth = false,
  accessibilityHint,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, radius, spacing } = useTheme();
  const isDisabled = disabled || loading;

  const palette: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: colors.primary, fg: colors.primaryText, border: colors.primary },
    secondary: { bg: 'transparent', fg: colors.text, border: colors.border },
    ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
    danger: { bg: colors.danger, fg: '#FFFFFF', border: colors.danger },
    success: { bg: colors.success, fg: '#FFFFFF', border: colors.success },
  };
  const scheme = palette[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        {
          backgroundColor: scheme.bg,
          borderColor: scheme.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.md,
          paddingVertical: spacing.md + 2,
          paddingHorizontal: spacing.lg,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: spacing.sm,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          minHeight: 48,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={scheme.fg} /> : null}
      <Text style={{ color: scheme.fg, fontSize: 15, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */
/* Fields                                                                     */
/* -------------------------------------------------------------------------- */

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  error,
  keyboardType = 'default',
  autoCapitalize = 'none',
  secureTextEntry = false,
  multiline = false,
  editable = true,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad' | 'url' | 'email-address';
  autoCapitalize?: 'none' | 'sentences' | 'words';
  secureTextEntry?: boolean;
  multiline?: boolean;
  editable?: boolean;
  testID?: string;
}) {
  const { colors, radius, spacing } = useTheme();

  return (
    <View style={{ gap: spacing.xs }}>
      <AppText variant="label">{label}</AppText>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        secureTextEntry={secureTextEntry}
        multiline={multiline}
        editable={editable}
        style={{
          backgroundColor: colors.surface,
          borderColor: error ? colors.danger : colors.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.md,
          color: colors.text,
          fontSize: 15,
          minHeight: multiline ? 110 : 48,
          textAlignVertical: multiline ? 'top' : 'center',
          opacity: editable ? 1 : 0.6,
        }}
      />
      {error ? (
        <AppText variant="caption" color={colors.danger}>
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" muted>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

export function SegmentedField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  error,
}: {
  label: string;
  value: T | null;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
  hint?: string;
  error?: string | null;
}) {
  const { colors, radius, spacing } = useTheme();

  return (
    <View style={{ gap: spacing.xs }}>
      <AppText variant="label">{label}</AppText>
      <View
        style={{
          flexDirection: 'row',
          borderRadius: radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: error ? colors.danger : colors.border,
          overflow: 'hidden',
        }}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={{
                flex: 1,
                paddingVertical: spacing.md,
                alignItems: 'center',
                backgroundColor: selected ? colors.primary : colors.surface,
                minHeight: 48,
                justifyContent: 'center',
              }}
            >
              <Text
                style={{
                  color: selected ? colors.primaryText : colors.text,
                  fontWeight: '600',
                  fontSize: 14,
                }}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <AppText variant="caption" color={colors.danger}>
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" muted>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Feedback                                                                   */
/* -------------------------------------------------------------------------- */

export function Banner({
  tone = 'info',
  title,
  message,
  action,
}: {
  tone?: Tone;
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void };
}) {
  const { colors, radius, spacing } = useTheme();
  const { foreground, background } = toneColors(tone, colors);

  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLabel={message ? `${title}. ${message}` : title}
      style={{
        backgroundColor: background,
        borderRadius: radius.md,
        padding: spacing.md,
        gap: spacing.xs,
      }}
    >
      <AppText variant="label" color={foreground}>
        {title}
      </AppText>
      {message ? (
        <AppText variant="caption" color={foreground}>
          {message}
        </AppText>
      ) : null}
      {action ? <Button label={action.label} variant="ghost" onPress={action.onPress} /> : null}
    </View>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ padding: spacing.xxl, alignItems: 'center', gap: spacing.md }}>
      <ActivityIndicator color={colors.primary} />
      <AppText variant="caption" muted>
        {label}
      </AppText>
    </View>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void };
}) {
  const { spacing } = useTheme();
  return (
    <View style={{ padding: spacing.xl, alignItems: 'center', gap: spacing.sm }}>
      <AppText variant="heading" align="center">
        {title}
      </AppText>
      {message ? (
        <AppText variant="body" muted align="center">
          {message}
        </AppText>
      ) : null}
      {action ? (
        <View style={{ marginTop: spacing.sm }}>
          <Button label={action.label} onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ padding: spacing.xl, alignItems: 'center', gap: spacing.sm }}>
      <AppText variant="heading" color={colors.danger} align="center">
        {title}
      </AppText>
      {message ? (
        <AppText variant="body" muted align="center">
          {message}
        </AppText>
      ) : null}
      {onRetry ? (
        <View style={{ marginTop: spacing.sm }}>
          <Button label="Try again" variant="secondary" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}

/** Rounds used, as a bar. Caps the fill so a bad server value cannot overflow. */
export function ProgressBar({ value, max, tone = 'info' }: { value: number; max: number; tone?: Tone }) {
  const { colors, radius } = useTheme();
  const { foreground } = toneColors(tone, colors);
  const ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${value} of ${max} rounds used`}
      accessibilityValue={{ min: 0, max, now: value }}
      style={{
        height: 6,
        backgroundColor: colors.border,
        borderRadius: radius.pill,
        overflow: 'hidden',
      }}
    >
      <View style={{ width: `${ratio * 100}%`, height: '100%', backgroundColor: foreground }} />
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Screen container                                                           */
/* -------------------------------------------------------------------------- */

export function ScreenScroll({
  children,
  refreshControl,
  contentPadding = true,
}: {
  children: ReactNode;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  contentPadding?: boolean;
}) {
  const { colors, spacing } = useTheme();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        padding: contentPadding ? spacing.lg : 0,
        paddingBottom: spacing.xxl * 2,
        gap: spacing.lg,
      }}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  /** For JSON schemas and ids, where column alignment carries meaning. */
  mono: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    letterSpacing: 0.2,
  },
});
