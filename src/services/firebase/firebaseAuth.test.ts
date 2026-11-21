import test from 'node:test';
import assert from 'node:assert/strict';
import type { User } from 'firebase/auth';
import {
  mapFirebaseAuthError,
  toAuthUserProfile,
  validateEmailFormat,
  validatePasswordStrength,
  validateRegistrationInput,
} from './firebaseAuth';
import { isFirebaseConfigured, resolveFirebaseConfig } from './firebaseConfig';

test('validateEmailFormat accepts valid addresses and rejects malformed inputs', () => {
  assert.equal(validateEmailFormat('allowsakib@gmail.com').valid, true);
  assert.equal(validateEmailFormat('  user+tag@studio.dev  ').valid, true);

  assert.equal(validateEmailFormat('').valid, false);
  assert.equal(validateEmailFormat('missing-at.com').valid, false);
  assert.equal(validateEmailFormat('user@domain').valid, false);
});

test('validatePasswordStrength enforces minimum length and scores complexity accurately', () => {
  const short = validatePasswordStrength('Ab1');
  assert.equal(short.valid, false);
  assert.equal(short.label, 'Too short');

  const weak = validatePasswordStrength('abcdefgh');
  assert.equal(weak.valid, true);
  assert.equal(weak.score, 1);

  const good = validatePasswordStrength('StudioPass1');
  assert.equal(good.valid, true);
  assert.ok(good.score >= 3);

  const strong = validatePasswordStrength('Studio!Pass99');
  assert.equal(strong.valid, true);
  assert.equal(strong.score, 4);
  assert.equal(strong.label, 'Strong');
});

test('validateRegistrationInput validates email, password strength, confirm match, and displayName length', () => {
  assert.equal(
    validateRegistrationInput({
      email: 'bad-email',
      password: 'Password123!',
      confirmPassword: 'Password123!',
    }).valid,
    false,
  );

  assert.equal(
    validateRegistrationInput({
      email: 'dev@example.com',
      password: 'Password123!',
      confirmPassword: 'Mismatch123!',
    }).valid,
    false,
  );

  assert.equal(
    validateRegistrationInput({
      email: 'dev@example.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      displayName: 'x'.repeat(121),
    }).valid,
    false,
  );

  assert.equal(
    validateRegistrationInput({
      email: 'dev@example.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      displayName: 'Studio Owner',
    }).valid,
    true,
  );
});

test('mapFirebaseAuthError provides safe, actionable messages for known Firebase Auth codes', () => {
  const opNotAllowed = mapFirebaseAuthError({ code: 'auth/operation-not-allowed' });
  assert.equal(opNotAllowed.code, 'auth/operation-not-allowed');
  assert.match(opNotAllowed.message, /Firebase Console/i);

  const wrongCreds = mapFirebaseAuthError({ code: 'auth/invalid-credential' });
  assert.equal(wrongCreds.message, 'Incorrect email or password.');

  const reauth = mapFirebaseAuthError({ code: 'auth/requires-recent-login' });
  assert.match(reauth.message, /re-authenticate/i);

  const network = mapFirebaseAuthError({ code: 'auth/network-request-failed' });
  assert.match(network.message, /offline-ready/i);
});

test('toAuthUserProfile projects Firebase User safely with provider IDs', () => {
  assert.equal(toAuthUserProfile(null), null);

  const mockUser = {
    uid: 'uid-123',
    email: 'owner@studio.app',
    displayName: 'Studio Owner',
    photoURL: null,
    emailVerified: true,
    isAnonymous: false,
    providerData: [{ providerId: 'google.com' }, { providerId: '' }],
  } as unknown as User;

  const profile = toAuthUserProfile(mockUser);
  assert.deepEqual(profile, {
    uid: 'uid-123',
    email: 'owner@studio.app',
    displayName: 'Studio Owner',
    photoURL: null,
    emailVerified: true,
    providerIds: ['google.com'],
    isAnonymous: false,
  });
});

test('resolveFirebaseConfig prioritizes provisioned firebase-applet-config.json over runtime env defaults', () => {
  const cfg = resolveFirebaseConfig();
  assert.equal(isFirebaseConfigured(cfg), true);
  assert.equal(cfg.projectId, 'concrete-keel-fggh3');
  assert.equal(
    cfg.firestoreDatabaseId,
    'ai-studio-personalaistudio-b88f1763-0672-43be-9877-c64cbd27e8c5',
  );
});
