import { useEffect, useState } from 'react';
import { AlertCircle, Eye, EyeOff, Lock, Mail, User, X } from 'lucide-react';
import {
  registerWithEmail,
  signInWithEmail,
  signInWithGooglePopup,
  validateEmailFormat,
  validatePasswordStrength,
  validateRegistrationInput,
} from '../../services/firebase/firebaseAuth';
import type { AuthUserProfile } from '../../types/workspace';

interface AuthModalProps {
  open: boolean;
  initialMode?: 'signin' | 'signup';
  onClose: () => void;
  onAuthenticated?: (user: AuthUserProfile) => void;
}

export function AuthModal({
  open,
  initialMode = 'signin',
  onClose,
  onAuthenticated,
}: AuthModalProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setError(null);
      setPassword('');
      setConfirmPassword('');
    }
  }, [open, initialMode]);

  if (!open) return null;

  const strength = validatePasswordStrength(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);

    if (mode === 'signin') {
      const emailCheck = validateEmailFormat(email);
      if (!emailCheck.valid) {
        setError(emailCheck.error || 'Enter a valid email address.');
        return;
      }
      if (!password) {
        setError('Password is required.');
        return;
      }

      setBusy(true);
      try {
        const res = await signInWithEmail({ email, password });
        if (!res.ok || !res.user) {
          setError(res.message || 'Sign in failed.');
          return;
        }
        onAuthenticated?.(res.user);
        onClose();
      } finally {
        setBusy(false);
      }
    } else {
      const regCheck = validateRegistrationInput({
        email,
        password,
        confirmPassword,
        displayName,
      });
      if (!regCheck.valid) {
        setError(regCheck.error || 'Check your registration fields.');
        return;
      }

      setBusy(true);
      try {
        const res = await registerWithEmail({
          email,
          password,
          confirmPassword,
          displayName,
        });
        if (!res.ok || !res.user) {
          setError(res.message || 'Account creation failed.');
          return;
        }
        onAuthenticated?.(res.user);
        onClose();
      } finally {
        setBusy(false);
      }
    }
  };

  const handleGoogleSignIn = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await signInWithGooglePopup();
      if (!res.ok || !res.user) {
        setError(res.message || 'Google Sign-In failed.');
        return;
      }
      onAuthenticated?.(res.user);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const strengthBarColors: Record<number, string> = {
    0: 'bg-zinc-700',
    1: 'bg-rose-500',
    2: 'bg-amber-500',
    3: 'bg-emerald-400',
    4: 'bg-emerald-500',
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        aria-hidden="true"
        onClick={() => {
          if (!busy) onClose();
        }}
        className="fixed inset-0 bg-black/75 backdrop-blur-sm"
      />

      <div className="relative z-10 w-full max-w-md max-h-[92dvh] overflow-y-auto rounded-2xl border border-white/[0.12] bg-[#10141A] p-5 shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="auth-modal-title" className="text-base font-semibold text-zinc-100">
              {mode === 'signin' ? 'Sign In to Cloud Sync' : 'Create Cloud Sync Account'}
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              Local IndexedDB stays primary. Signing in syncs your workspace across devices via
              Firebase.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close authentication modal"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div
          role="tablist"
          aria-label="Authentication mode"
          className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#090B0E] border border-white/[0.08]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signin'}
            onClick={() => {
              setMode('signin');
              setError(null);
            }}
            className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
              mode === 'signin'
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signup'}
            onClick={() => {
              setMode('signup');
              setError(null);
            }}
            className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
              mode === 'signup'
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Create Account
          </button>
        </div>

        {/* Google Sign-In */}
        <button
          type="button"
          onClick={() => void handleGoogleSignIn()}
          disabled={busy}
          data-testid="google-signin-button"
          className="w-full min-h-[44px] px-4 rounded-xl border border-white/15 bg-white/[0.05] hover:bg-white/[0.09] text-xs font-semibold text-zinc-100 inline-flex items-center justify-center gap-2.5 transition-colors disabled:opacity-50"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4 shrink-0">
            <path
              fill="#EA4335"
              d="M12 10.2v3.9h5.4c-.2 1.2-1.5 3.6-5.4 3.6-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.7 0 9.4-4 9.4-9.6 0-.6-.1-1.1-.2-1.6H12z"
            />
          </svg>
          <span>Continue with Google</span>
        </button>

        <div className="flex items-center gap-3 text-[11px] text-zinc-500">
          <div className="h-px flex-1 bg-white/[0.08]" />
          <span>or continue with email</span>
          <div className="h-px flex-1 bg-white/[0.08]" />
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-3.5">
          {mode === 'signup' && (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-300">Display Name (Optional)</span>
              <div className="relative">
                <User className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={120}
                  placeholder="Alex Developer"
                  autoComplete="name"
                  className="w-full h-11 pl-9 pr-3 rounded-xl bg-[#090B0E] border border-white/15 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </label>
          )}

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-zinc-300">Email Address</span>
            <div className="relative">
              <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                className="w-full h-11 pl-9 pr-3 rounded-xl bg-[#090B0E] border border-white/15 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-zinc-300">Password</span>
            <div className="relative">
              <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'At least 8 characters' : 'Enter your password'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                className="w-full h-11 pl-9 pr-11 rounded-xl bg-[#090B0E] border border-white/15 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-[38px] min-w-[38px] inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-200"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </label>

          {mode === 'signup' && password.length > 0 && (
            <div className="space-y-1.5 rounded-xl bg-[#090B0E] border border-white/[0.07] p-2.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-zinc-400">Password strength</span>
                <span
                  className={
                    strength.score >= 3
                      ? 'text-emerald-300 font-medium'
                      : strength.score === 2
                        ? 'text-amber-300 font-medium'
                        : 'text-rose-300 font-medium'
                  }
                >
                  {strength.label}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {[1, 2, 3, 4].map((step) => (
                  <div
                    key={step}
                    className={`h-1.5 rounded-full transition-colors ${
                      strength.score >= step ? strengthBarColors[strength.score] : 'bg-white/10'
                    }`}
                  />
                ))}
              </div>
              {strength.issues.length > 0 && (
                <p className="text-[11px] text-zinc-400 leading-snug">
                  {strength.issues[0]}
                </p>
              )}
            </div>
          )}

          {mode === 'signup' && (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-300">Confirm Password</span>
              <div className="relative">
                <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  autoComplete="new-password"
                  required
                  className="w-full h-11 pl-9 pr-3 rounded-xl bg-[#090B0E] border border-white/15 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </label>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/35 bg-rose-950/40 px-3 py-2.5 text-xs text-rose-100 flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full min-h-[44px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#052317] text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {busy
              ? mode === 'signin'
                ? 'Signing In…'
                : 'Creating Account…'
              : mode === 'signin'
                ? 'Sign In with Email'
                : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
