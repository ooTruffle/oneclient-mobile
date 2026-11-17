import { useRouter } from 'expo-router';
import { SignInView } from './sign-in';

/** Signs in another account next to the current one; it becomes the active account. */
export default function AddAccountScreen() {
  const router = useRouter();
  return (
    <SignInView
      adding
      onSignedIn={() => {
        // Close this screen and start the new account on its Chats list.
        if (router.canDismiss()) router.dismissAll();
        router.replace('/');
      }}
    />
  );
}
