import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export interface VerifiedAuthContext {
  uid: string;
  email: string | null;
  emailVerified: boolean;
}

export interface AuthenticatedRequest extends Request {
  auth?: VerifiedAuthContext;
}

export type VerifyIdTokenFn = (idToken: string) => Promise<{
  uid: string;
  email?: string;
  email_verified?: boolean;
}>;

interface AppletConfigFile {
  projectId?: string;
}

let cachedAdminApp: App | null = null;
let cachedProjectId: string | null | undefined;

export function readConfiguredFirebaseProjectId(configPath?: string): string | null {
  if (!configPath && cachedProjectId !== undefined) {
    return cachedProjectId;
  }

  const resolvedPath = configPath ?? path.resolve(process.cwd(), 'firebase-applet-config.json');
  try {
    if (!fs.existsSync(resolvedPath)) {
      if (!configPath) cachedProjectId = null;
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(resolvedPath, 'utf8')) as AppletConfigFile;
    const projectId = typeof raw.projectId === 'string' ? raw.projectId.trim() : '';
    if (!projectId || projectId === 'remixed-project-id') {
      if (!configPath) cachedProjectId = null;
      return null;
    }
    if (!configPath) cachedProjectId = projectId;
    return projectId;
  } catch {
    if (!configPath) cachedProjectId = null;
    return null;
  }
}

export function isFirebaseAdminAuthReady(): boolean {
  return readConfiguredFirebaseProjectId() !== null;
}

function getFirebaseAdminApp(): App | null {
  if (cachedAdminApp) return cachedAdminApp;
  const projectId = readConfiguredFirebaseProjectId();
  if (!projectId) return null;

  cachedAdminApp = getApps().length > 0 ? getApp() : initializeApp({ projectId });
  return cachedAdminApp;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedAuthContext> {
  const app = getFirebaseAdminApp();
  if (!app) {
    const err = new Error('Firebase authentication project is not configured on the server.');
    (err as Error & { code?: string }).code = 'auth/not-configured';
    throw err;
  }

  // verifyIdToken(token) without checkRevoked=true validates JWT signature, audience,
  // issuer, and expiry via Google public keys without requiring IAM roles.
  const decoded = await getAuth(app).verifyIdToken(idToken);
  return {
    uid: decoded.uid,
    email: typeof decoded.email === 'string' ? decoded.email : null,
    emailVerified: Boolean(decoded.email_verified),
  };
}

export function extractBearerToken(authorizationHeader: string | undefined): {
  ok: true;
  token: string;
} | {
  ok: false;
  code: 'auth_missing' | 'auth_malformed';
  message: string;
} {
  if (!authorizationHeader || !authorizationHeader.trim()) {
    return {
      ok: false,
      code: 'auth_missing',
      message: 'Authentication required. Sign in with your workspace account to chat with Gemini.',
    };
  }

  const match = /^Bearer\s+([^\s]+)$/i.exec(authorizationHeader.trim());
  if (!match || !match[1]) {
    return {
      ok: false,
      code: 'auth_malformed',
      message: 'Invalid Authorization header format. Expected "Bearer <idToken>".',
    };
  }

  return { ok: true, token: match[1] };
}

export function createFirebaseAuthMiddleware(
  verifyFn?: VerifyIdTokenFn,
): (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void> {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const extracted = extractBearerToken(req.header('authorization'));
    if (!extracted.ok) {
      res.status(401).json({
        ok: false,
        code: extracted.code,
        message: extracted.message,
      });
      return;
    }

    try {
      if (verifyFn) {
        const decoded = await verifyFn(extracted.token);
        if (!decoded?.uid) {
          res.status(401).json({
            ok: false,
            code: 'auth_invalid',
            message: 'Verified token did not contain a valid user identifier.',
          });
          return;
        }
        req.auth = {
          uid: decoded.uid,
          email: typeof decoded.email === 'string' ? decoded.email : null,
          emailVerified: Boolean(decoded.email_verified),
        };
      } else {
        req.auth = await verifyFirebaseIdToken(extracted.token);
      }
      next();
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code ?? '')
          : '';
      if (code === 'auth/not-configured') {
        res.status(503).json({
          ok: false,
          code: 'auth_unavailable',
          message: 'Server Firebase Authentication configuration is missing.',
        });
        return;
      }

      const isExpired = code === 'auth/id-token-expired';
      res.status(401).json({
        ok: false,
        code: isExpired ? 'auth_expired' : 'auth_invalid',
        message: isExpired
          ? 'Your sign-in session expired. Refreshing or signing in again is required.'
          : 'Invalid or rejected authentication token. Please sign in again.',
      });
    }
  };
}
