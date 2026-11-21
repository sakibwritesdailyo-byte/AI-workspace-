import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  type Auth,
} from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  type Firestore,
} from 'firebase/firestore';
import appletConfig from '../../../firebase-applet-config.json';

export interface ResolvedFirebaseConfig extends FirebaseOptions {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
  firestoreDatabaseId?: string;
  oAuthClientId?: string;
}

export interface FirebaseServiceHandles {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  config: ResolvedFirebaseConfig;
}

export interface ConnectionCheckResult {
  reachable: boolean;
  offline: boolean;
  error: string | null;
}

function readViteEnv(key: string): string {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
    const raw = env?.[key];
    return typeof raw === 'string' ? raw.trim() : '';
  } catch {
    return '';
  }
}

export function resolveFirebaseConfig(): ResolvedFirebaseConfig {
  const fileCfg = appletConfig as Partial<ResolvedFirebaseConfig> | undefined;
  const hasProvisionedAppletConfig = Boolean(
    fileCfg?.apiKey &&
      fileCfg?.authDomain &&
      fileCfg?.projectId &&
      fileCfg.projectId !== 'remixed-project-id' &&
      fileCfg?.appId,
  );

  // Provisioned firebase-applet-config.json is authoritative so runtime/container
  // VITE_FIREBASE_* variables from unrelated defaults cannot hijack the app's project or DB.
  if (hasProvisionedAppletConfig && fileCfg) {
    return {
      apiKey: fileCfg.apiKey!,
      authDomain: fileCfg.authDomain!,
      projectId: fileCfg.projectId!,
      storageBucket: fileCfg.storageBucket || undefined,
      messagingSenderId: fileCfg.messagingSenderId || undefined,
      appId: fileCfg.appId!,
      firestoreDatabaseId: fileCfg.firestoreDatabaseId || undefined,
      oAuthClientId: fileCfg.oAuthClientId,
    };
  }

  const apiKey = readViteEnv('VITE_FIREBASE_API_KEY') || fileCfg?.apiKey || '';
  const authDomain = readViteEnv('VITE_FIREBASE_AUTH_DOMAIN') || fileCfg?.authDomain || '';
  const projectId = readViteEnv('VITE_FIREBASE_PROJECT_ID') || fileCfg?.projectId || '';
  const storageBucket =
    readViteEnv('VITE_FIREBASE_STORAGE_BUCKET') || fileCfg?.storageBucket || undefined;
  const messagingSenderId =
    readViteEnv('VITE_FIREBASE_MESSAGING_SENDER_ID') || fileCfg?.messagingSenderId || undefined;
  const appId = readViteEnv('VITE_FIREBASE_APP_ID') || fileCfg?.appId || '';
  const firestoreDatabaseId =
    readViteEnv('VITE_FIREBASE_DATABASE_ID') || fileCfg?.firestoreDatabaseId || undefined;

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
    firestoreDatabaseId,
    oAuthClientId: fileCfg?.oAuthClientId,
  };
}

export function isFirebaseConfigured(config: ResolvedFirebaseConfig = resolveFirebaseConfig()): boolean {
  return Boolean(
    config.apiKey &&
      config.authDomain &&
      config.projectId &&
      config.projectId !== 'remixed-project-id' &&
      config.appId,
  );
}

let cachedServices: FirebaseServiceHandles | null = null;
let persistenceInitialized = false;

function createFirestoreInstance(app: FirebaseApp, databaseId?: string): Firestore {
  try {
    return databaseId
      ? initializeFirestore(app, { experimentalAutoDetectLongPolling: true }, databaseId)
      : initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  } catch {
    return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
  }
}

export function getFirebaseServices(): FirebaseServiceHandles | null {
  if (cachedServices) {
    return cachedServices;
  }

  const config = resolveFirebaseConfig();
  if (!isFirebaseConfigured(config)) {
    return null;
  }

  const existingApps = getApps();
  const app = existingApps.length > 0 ? existingApps[0] : initializeApp(config);
  const db = createFirestoreInstance(app, config.firestoreDatabaseId);
  const auth = getAuth(app);

  if (!persistenceInitialized && typeof window !== 'undefined') {
    persistenceInitialized = true;
    void setPersistence(auth, browserLocalPersistence).catch(() => {
      // Fallback safely if browser storage restrictions prevent persistence customization
    });
  }

  cachedServices = { app, auth, db, config };
  return cachedServices;
}

/**
 * Verifies Firestore backend reachability on startup per SDK guidance.
 * A permission-denied response on `/test/connection` still confirms network/server reachability,
 * whereas `'the client is offline'` while online indicates network/config unavailability.
 */
export async function testFirestoreConnection(): Promise<ConnectionCheckResult> {
  const services = getFirebaseServices();
  if (!services) {
    return {
      reachable: false,
      offline: false,
      error: 'Firebase configuration is missing or incomplete.',
    };
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      reachable: false,
      offline: true,
      error: 'Device is offline; local IndexedDB mode active.',
    };
  }

  try {
    await getDocFromServer(doc(services.db, 'test', 'connection'));
    return { reachable: true, offline: false, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const offline =
      message.toLowerCase().includes('the client is offline') ||
      message.toLowerCase().includes('network-request-failed');
    if (offline) {
      console.error('Please check your Firebase configuration.', message);
      return { reachable: false, offline: true, error: message };
    }
    // Non-offline errors (such as permission-denied on /test/connection) confirm Firestore responded
    return { reachable: true, offline: false, error: null };
  }
}
