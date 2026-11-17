// Drop-in for Alert.alert, drawn by <DialogHost /> as Material 3 instead of the
// platform's own dialog:
//   - with a message → an M3 dialog (title, text, buttons bottom-right)
//   - without one    → an M3 bottom sheet menu (e.g. long-press actions)
// Works on web too. Falls back to Alert.alert if no host is mounted.

import { Alert, type AlertButton } from 'react-native';

export interface DialogRequest {
  id: number;
  title: string;
  message?: string;
  buttons: AlertButton[];
}

let nextId = 1;
let queue: DialogRequest[] = [];
const listeners = new Set<() => void>();
let hosts = 0;

const emit = () => listeners.forEach((l) => l());

export const dialogStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** The dialog on screen now (the first one queued). */
  current: (): DialogRequest | undefined => queue[0],
  /** Called by the host once the user picks a button (or dismisses). */
  close(id: number) {
    queue = queue.filter((d) => d.id !== id);
    emit();
  },
  attachHost() {
    hosts++;
    return () => {
      hosts--;
    };
  },
};

export function alert(title: string, message?: string, buttons?: AlertButton[]) {
  if (hosts === 0) {
    Alert.alert(title, message, buttons);
    return;
  }
  queue = [...queue, { id: nextId++, title, message, buttons: buttons?.length ? buttons : [{ text: 'OK' }] }];
  emit();
}
