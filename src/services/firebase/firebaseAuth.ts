import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import type { AuthUserProfile } from '../../types/workspace';
import { getFirebaseServices } from './firebaseConfig';

export interface AuthActionResult<T = AuthUserProfile> {
  ok: boolean;
  user?: T;
  errorCode?: string;
  message?: string;
}

export interface PasswordStrengthResult {
  valid: boolean;
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Too short' | 'Weak' | 'Fair' | 'Good' | 'Strong';
  issues: string[];
}

export function toAuthUserProfile(user: User | null): AuthUserProfile | null {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    photoURL: user.photoURL ?? null,
    emailVerified: Boolean(user.emailVerified),
    providerIds: user.providerData
      .map((p) => p?.providerId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
    isAnonymous: Boolean(user.isAnonymous),
  };
}

export function validateEmailFormat(email: string): { valid: boolean; error?: string } {
  const trimmed = email.trim();
  if (!trimmed) {
    return { valid: false, error: 'Email address is required.' };
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!emailRegex.test(trimmed)) {
    return { valid: false, error: 'Enter a valid email address (for example, name@example.com).' };
  }
  return { valid: true };
}

export function validatePasswordStrength(password: string): PasswordStrengthResult {
  const issues: string[] = [];
  if (password.length < 8) {
    issues.push('At least 8 characters');
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
    issues.push('Mix of uppercase and lowercase letters recommended');
  }
  if (!/\d/.test(password)) {
    issues.push('At least one number recommended');
  }

  if (password.length < 8) {
    return { valid: false, score: password.length >= 4 ? 1 : 0, label: 'Too short', issues };
  }

  let strengthPoints = 1;
  if (password.length >= 10) strengthPoints += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strengthPoints += 1;
  if (/\d/.test(password) && /[^a-zA-Z0-9]/.test(password)) strengthPoints += 1;
  else if (/\d/.test(password) || /[^a-zA-Z0-9]/.test(password)) strengthPoints += 0;

  const score = Math.min(4, Math.max(1, strengthPoints)) as 1 | 2 | 3 | 4;
  const label =
    score === 4 ? 'Strong' : score === 3 ? 'Good' : score === 2 ? 'Fair' : 'Weak';
  return { valid: true, score, label, issues };
}

export function validateRegistrationInput(input: {
  email: string;
  password: string;
  confirmPassword: string;
  displayName?: string;
}): { valid: boolean; error?: string } {
  const emailCheck = validateEmailFormat(input.email);
  if (!emailCheck.valid) return emailCheck;

  const passCheck = validatePasswordStrength(input.password);
  if (!passCheck.valid) {
    return { valid: false, error: 'Password must be at least 8 characters long.' };
  }

  if (input.password !== input.confirmPassword) {
    return { valid: false, error: 'Passwords do not match.' };
  }

  if (input.displayName && input.displayName.trim().length > 120) {
    return { valid: false, error: 'Display name must be 120 characters or fewer.' };
  }

  return { valid: true };
}

export function mapFirebaseAuthError(error: unknown): { code: string; message: string } {
  const rawCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
  const rawMsg = error instanceof Error ? error.message : String(error ?? '');

  switch (rawCode) {
    case 'auth/email-already-in-use':
      return {
        code: rawCode,
        message: 'An account with this email already exists. Try signing in instead.',
      };
    case 'auth/invalid-email':
      return { code: rawCode, message: 'That email address does not appear valid.' };
    case 'auth/user-disabled':
      return { code: rawCode, message: 'This account has been disabled.' };
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return { code: rawCode, message: 'Incorrect email or password.' };
    case 'auth/weak-password':
      return {
        code: rawCode,
        message: 'Choose a stronger password (at least 8 characters recommended).',
      };
    case 'auth/too-many-requests':
      return {
        code: rawCode,
        message: 'Too many sign-in attempts. Wait a moment before trying again.',
      };
    case 'auth/network-request-failed':
      return {
        code: rawCode,
        message: 'Network unavailable. Your local workspace stays offline-ready until connected.',
      };
    case 'auth/operation-not-allowed':
      return {
        code: rawCode,
        message:
          'Email/Password sign-in is not yet enabled in Firebase Console -> Authentication -> Sign-in method. Enable it or use Google Sign-In.',
      };
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return { code: rawCode, message: 'Sign-in window was closed before completing.' };
    case 'auth/popup-blocked':
      return {
        code: rawCode,
        message: 'Sign-in popup was blocked by your browser. Allow popups for this site and retry.',
      };
    case 'auth/unauthorized-domain':
      return {
        code: rawCode,
        message:
          'This domain is not authorized in Firebase Console -> Authentication -> Settings -> Authorized domains.',
      };
    case 'auth/requires-recent-login':
      return {
        code: rawCode,
        message: 'For security, please re-authenticate before deleting your account.',
      };
    default:
      return {
        code: rawCode || 'auth/unknown',
        message: rawMsg || 'Authentication failed. Please try again.',
      };
  }
}

export function subscribeAuthState(
  onUserChange: (user: AuthUserProfile | null) => void,
  onError?: (message: string) => void,
): () => void {
  const services = getFirebaseServices();
  if (!services) {
    onUserChange(null);
    return () => {};
  }

  return onAuthStateChanged(
    services.auth,
    (firebaseUser) => {
      onUserChange(toAuthUserProfile(firebaseUser));
    },
    (err) => {
      const mapped = mapFirebaseAuthError(err);
      onError?.(mapped.message);
    },
  );
}

export async function registerWithEmail(input: {
  email: string;
  password: string;
  confirmPassword: string;
  displayName?: string;
}): Promise<AuthActionResult> {
  const validation = validateRegistrationInput(input);
  if (!validation.valid) {
    return { ok: false, errorCode: 'validation/invalid-input', message: validation.error };
  }

  const services = getFirebaseServices();
  if (!services) {
    return { ok: false, errorCode: 'firebase/not-configured', message: 'Firebase is not configured.' };
  }

  try {
    const credential = await createUserWithEmailAndPassword(
      services.auth,
      input.email.trim(),
      input.password,
    );
    const trimmedName = input.displayName?.trim();
    if (trimmedName) {
      await updateProfile(credential.user, { displayName: trimmedName });
    }
    const profile = toAuthUserProfile(services.auth.currentUser ?? credential.user);
    return { ok: true, user: profile ?? undefined };
  } catch (err) {
    const mapped = mapFirebaseAuthError(err);
    return { ok: false, errorCode: mapped.code, message: mapped.message };
  }
}

export async function signInWithEmail(input: {
  email: string;
  password: string;
}): Promise<AuthActionResult> {
  const emailCheck = validateEmailFormat(input.email);
  if (!emailCheck.valid) {
    return { ok: false, errorCode: 'validation/invalid-email', message: emailCheck.error };
  }
  if (!input.password) {
    return { ok: false, errorCode: 'validation/empty-password', message: 'Password is required.' };
  }

  const services = getFirebaseServices();
  if (!services) {
    return { ok: false, errorCode: 'firebase/not-configured', message: 'Firebase is not configured.' };
  }

  try {
    const credential = await signInWithEmailAndPassword(
      services.auth,
      input.email.trim(),
      input.password,
    );
    const profile = toAuthUserProfile(credential.user);
    return { ok: true, user: profile ?? undefined };
  } catch (err) {
    const mapped = mapFirebaseAuthError(err);
    return { ok: false, errorCode: mapped.code, message: mapped.message };
  }
}

export async function signInWithGooglePopup(): Promise<AuthActionResult> {
  const services = getFirebaseServices();
  if (!services) {
    return { ok: false, errorCode: 'firebase/not-configured', message: 'Firebase is not configured.' };
  }

  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const credential = await signInWithPopup(services.auth, provider);
    const profile = toAuthUserProfile(credential.user);
    return { ok: true, user: profile ?? undefined };
  } catch (err) {
    const mapped = mapFirebaseAuthError(err);
    return { ok: false, errorCode: mapped.code, message: mapped.message };
  }
}

export async function sendVerificationEmailToCurrentUser(): Promise<AuthActionResult<void>> {
  const services = getFirebaseServices();
  const user = services?.auth.currentUser;
  if (!user) {
    return { ok: false, errorCode: 'auth/no-user', message: 'No signed-in user.' };
  }
  try {
    await sendEmailVerification(user);
    return { ok: true };
  } catch (err) {
    const mapped = mapFirebaseAuthError(err);
    return { ok: false, errorCode: mapped.code, message: mapped.message };
  }
}

export async function signOutUser(): Promise<AuthActionResult<void>> {
  const services = getFirebaseServices();
  if (!services) {
    return { ok: true };
  }
  try {
    await signOut(services.auth);
    return { ok: true };
  } catch (err) {
    const mapped = mapFirebaseAuthError(err);
    return { ok: false, errorCode: mapped.code, message: mapped.message };
  }
}

export async function deleteAuthAccount(options: {
  cleanupCloudData: (uid: string) => Promise<void>;
  reauthPassword?: string;
  reauthWithGoogle?: boolean;
}): Promise<AuthActionResult<void>> {
  const services = getFirebaseServices();
  const currentUser = services?.auth.currentUser;
  if (!services || !currentUser) {
    return { ok: false, errorCode: 'auth/no-user', message: 'No authenticated account to delete.' };
  }

  try {
    if (options.reauthPassword && currentUser.email) {
      const cred = EmailAuthProvider.credential(currentUser.email, options.reauthPassword);
      await reauthenticateWithCredential(currentUser, cred);
    } else if (options.reauthWithGoogle) {
      const provider = new GoogleAuthProvider();
      await reauthenticateWithPopup(currentUser, provider);
    }

    await options.cleanupCloudData(currentUser.uid);
    await deleteUser(currentUser);
    return { ok: true };
  } catch (err) {
    const mapped = mapFirebaseAuthError(err);
    return { ok: false, errorCode: mapped.code, message: mapped.message };
  }
}
