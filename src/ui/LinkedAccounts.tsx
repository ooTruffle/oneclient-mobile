import * as Linking from 'expo-linking';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Text } from 'react-native';
import { plus } from '@/api/plus';
import type { LinkedAccount } from '@/api/types';
import { alert } from '@/lib/dialog';
import { errorMessage, HttpError } from '@/lib/http';
import { relativeTime } from '@/lib/format';
import { Button, Card, Row } from './components';
import { makeStyles, spacing, type, useTheme } from './theme';

/** Providers the server can link. Discord is the only one today. */
const PROVIDERS = [{ id: 'discord', name: 'Discord' }] as const;

function describe(err: unknown): string {
  if (err instanceof HttpError && err.status === 503) return "Discord linking isn't turned on for this server yet.";
  return errorMessage(err);
}

/**
 * Linked accounts card for the Profile tab. Linking happens on Discord's own
 * consent page in the browser and the server finishes it, so the app just
 * re-checks the list when you come back.
 */
export function LinkedAccounts() {
  const c = useTheme();
  const styles = useStyles();
  const [links, setLinks] = useState<LinkedAccount[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const waitingRef = useRef(false);
  waitingRef.current = waiting;

  const load = useCallback(async () => {
    try {
      setLinks(await plus.linkedAccounts());
      setError(null);
    } catch (err) {
      setError(describe(err));
    }
  }, []);

  useEffect(() => {
    void load();
    // Back from the browser: see whether the link went through.
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && waitingRef.current) {
        setWaiting(false);
        void load();
      }
    });
    return () => sub.remove();
  }, [load]);

  const link = async (provider: string) => {
    setBusy(provider);
    setError(null);
    try {
      const { url } = await plus.startDiscordLink();
      setWaiting(true);
      await Linking.openURL(url);
    } catch (err) {
      setWaiting(false);
      setError(describe(err));
    } finally {
      setBusy(null);
    }
  };

  const unlink = (provider: string, label: string) =>
    alert(`Unlink ${label}?`, `Your ${label} account will no longer be connected to this Minecraft account.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unlink',
        style: 'destructive',
        onPress: async () => {
          setBusy(provider);
          try {
            await plus.unlinkAccount(provider);
            await load();
          } catch (err) {
            setError(describe(err));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  return (
    <Card>
      {links === null && !error ? (
        <ActivityIndicator style={{ margin: spacing.lg }} color={c.primary} />
      ) : (
        PROVIDERS.map((p) => {
          const linked = links?.find((l) => l.provider === p.id);
          return (
            <Row
              key={p.id}
              title={p.name}
              subtitle={
                linked
                  ? `${linked.username ? `@${linked.username}` : 'Linked'} · ${relativeTime(linked.linked_at)}`
                  : waiting
                    ? 'Finish in your browser, then come back here'
                    : 'Not linked'
              }
              right={
                linked ? (
                  <Button
                    title="Unlink"
                    variant="secondary"
                    compact
                    loading={busy === p.id}
                    onPress={() => unlink(p.id, p.name)}
                  />
                ) : (
                  <Button title="Link" compact loading={busy === p.id} onPress={() => void link(p.id)} />
                )
              }
            />
          );
        })
      )}
      {waiting && (
        <Text style={styles.note} onPress={() => void load()}>
          Done in the browser? Tap here to check.
        </Text>
      )}
      {error && <Text style={[styles.note, { color: c.error }]}>{error}</Text>}
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  note: { color: c.onSurfaceVariant, ...type.bodySmall, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
}));
