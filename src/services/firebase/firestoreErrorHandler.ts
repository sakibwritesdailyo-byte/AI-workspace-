import type { Auth } from 'firebase/auth';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export type FirestoreFailureCategory =
  | 'offline'
  | 'quota_exceeded'
  | 'permission_denied'
  | 'transient'
  | 'permanent';

export function buildFirestoreErrorInfo(
  error: unknown,
  operationType: OperationType,
  path: string | null,
  auth?: Auth | null,
): FirestoreErrorInfo {
  const currentUser = auth?.currentUser ?? null;
  return {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    authInfo: {
      userId: currentUser?.uid ?? null,
      email: currentUser?.email ?? null,
      emailVerified: currentUser?.emailVerified ?? null,
      isAnonymous: currentUser?.isAnonymous ?? null,
      tenantId: currentUser?.tenantId ?? null,
      providerInfo:
        currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) ?? [],
    },
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
  auth?: Auth | null,
): never {
  const errInfo = buildFirestoreErrorInfo(error, operationType, path, auth);
  const serialized = JSON.stringify(errInfo);
  console.error('Firestore Error: ', serialized);
  throw new Error(serialized);
}

export function extractRawFirestoreMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? 'Unknown Firestore error');
  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const parsed = JSON.parse(raw) as Partial<FirestoreErrorInfo>;
      if (typeof parsed.error === 'string' && parsed.error) {
        return parsed.error;
      }
    } catch {
      // Fallback to raw message
    }
  }
  return raw;
}

export function classifyFirestoreError(error: unknown): FirestoreFailureCategory {
  const msg = extractRawFirestoreMessage(error).toLowerCase();
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '').toLowerCase()
      : '';

  if (
    code.includes('resource-exhausted') ||
    msg.includes('quota exceeded') ||
    msg.includes('resource-exhausted')
  ) {
    return 'quota_exceeded';
  }
  if (
    code.includes('permission-denied') ||
    msg.includes('missing or insufficient permissions') ||
    msg.includes('permission_denied')
  ) {
    return 'permission_denied';
  }
  if (
    msg.includes('the client is offline') ||
    msg.includes('failed to get document because the client is offline') ||
    (typeof navigator !== 'undefined' && navigator.onLine === false && (code.includes('unavailable') || msg.includes('network')))
  ) {
    return 'offline';
  }
  if (
    code.includes('unavailable') ||
    code.includes('deadline-exceeded') ||
    code.includes('aborted') ||
    code.includes('internal') ||
    msg.includes('timeout') ||
    msg.includes('network')
  ) {
    return 'transient';
  }
  if (
    code.includes('invalid-argument') ||
    code.includes('failed-precondition') ||
    msg.includes('invalid')
  ) {
    return 'permanent';
  }
  return 'transient';
}

export function formatUserFriendlyFirestoreError(error: unknown): string {
  const category = classifyFirestoreError(error);
  const raw = extractRawFirestoreMessage(error);
  switch (category) {
    case 'quota_exceeded':
      return 'Firestore free-tier daily quota was exceeded. Local edits remain safe in IndexedDB; quota resets daily.';
    case 'permission_denied':
      return 'Cloud sync permission denied. Please verify your account session or Firestore security rules.';
    case 'offline':
      return 'Cloud sync paused while offline. Changes are queued locally and will sync automatically when reconnected.';
    case 'permanent':
      return `Cloud sync rejected a document payload: ${raw}`;
    case 'transient':
      return `Temporary cloud sync error: ${raw}`;
  }
}
