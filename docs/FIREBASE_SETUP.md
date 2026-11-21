# Firebase Authentication & Cloud Firestore Setup Guide

This guide covers the Phase 3 Firebase configuration, security rules, provider setup, and verification steps for **Personal AI Studio**.

## 1. Provisioned Firebase Project

- **Project ID**: `concrete-keel-fggh3`
- **Named Firestore Database ID**: `ai-studio-personalaistudio-b88f1763-0672-43be-9877-c64cbd27e8c5`
- **Client Config**: `/firebase-applet-config.json` (contains public Firebase Web SDK configuration only; never place Admin SDK keys or service-account JSON inside the client bundle or `.env`).
- **Firestore Blueprint**: `/firebase-blueprint.json`
- **Firestore Security Rules**: `/firestore.rules` (validated via `@firebase/eslint-plugin-security-rules` and deployed via `DeployRules`).

The client initializes Firestore with the named database ID via:

```ts
getFirestore(app, config.firestoreDatabaseId);
```

Optional `VITE_FIREBASE_*` overrides are documented in `/.env.example`.

---

## 2. Firebase Console Authentication Providers (Manual Verification Step)

AI Studio's `ProvisionFirebase` configures Google OAuth automatically, while **Email/Password** authentication must be enabled once in the Firebase Console:

1. Open **Firebase Console** -> select project **`concrete-keel-fggh3`**.
2. Go to **Build -> Authentication -> Sign-in method**.
3. Verify **Google** is enabled.
4. Click **Add new provider -> Email/Password** and enable **Email/Password** -> click **Save**.
5. Open **Authentication -> Settings -> Authorized domains** and verify your active domains are listed:
   - `localhost`
   - `127.0.0.1`
   - `ais-dev-w2ppkmqenbgdrnlq3pjsxj-514298900152.asia-southeast1.run.app`
   - `ais-pre-w2ppkmqenbgdrnlq3pjsxj-514298900152.asia-southeast1.run.app`
   - Plus any custom domain where you host the PWA.

> **Note**: If a user attempts Email/Password registration or sign-in before enabling it in Firebase Console, the app maps `auth/operation-not-allowed` to a clear setup notice instructing them to enable the provider or use Google Sign-In.

---

## 3. Firestore Data Model & Security Rules

All cloud data is nested under strict user-owned paths (`/users/{uid}/...`):

- `/users/{uid}` (`UserProfile`)
- `/users/{uid}/preferences/{settingKey}` (`voiceSettings` | `modelSettings` | `appSettings` only — `device_local` UI pointers are blocked by both client policy and `firestore.rules`)
- `/users/{uid}/projects/{projectId}` (`WorkspaceProject`)
- `/users/{uid}/files/{fileId}` (`WorkspaceFile`, verified against parent project existence via `existsAfter`)
- `/users/{uid}/conversations/{conversationId}` (`WorkspaceConversation`)
- `/users/{uid}/messages/{messageId}` (`WorkspaceMessage`, verified against parent conversation existence via `existsAfter`)
- `/users/{uid}/voiceSessions/{sessionId}` (`WorkspaceVoiceSession`, enforces `rawAudioStored == false`)
- `/users/{uid}/tombstones/{tombstoneId}` (`SyncTombstone`, document ID format `${entityType}__${entityId}`)
- `/users/{uid}/syncMeta/{metaId}` (`SyncMetaState`)

Rules enforce:
- Default-deny catch-all at root (`match /{document=**} { allow read, write: if false; }`).
- `isOwner(uid)` authentication + `ownerUid == request.auth.uid` checks on reads/list queries and mutations.
- Strict field validation (`hasAll`, `hasOnly`, type/size bounds) and immutable `createdAt`/`serverCreatedAt`/`ownerUid` fields on updates.

Validate rules locally anytime with:

```bash
npx eslint firestore.rules
```

---

## 4. Local-First Sync Architecture Notes

- **IndexedDB remains primary**: All reads/writes go to local IndexedDB first (`personal_ai_studio_db`, v4).
- **Pull-before-push reconciliation**: Before draining the outbox, `CloudSyncCoordinator` pulls remote state and tombstones and reconciles concurrent edits non-destructively using conflict copies (`Name (Conflict Copy)`, `file.conflict-copy.ext`, `Name (Restored Copy)`).
- **Unclaimed local data protection**: Signing into an account when local-only (`ownerUid: null`) workspace items exist pauses automatic sync and prompts the user via `ClaimLocalDataDialog` to either **Merge Local Data Into Account & Sync** or **Keep Local Data Separate on Device**.
- **Account deletion**: `DeleteAccountDialog` requires explicit confirmation (`DELETE`), deletes all subcollection records in `/users/{uid}`, removes the Firebase Auth user (handling `auth/requires-recent-login` re-authentication), and optionally removes cached account data from local IndexedDB while leaving separate local-only data intact.
