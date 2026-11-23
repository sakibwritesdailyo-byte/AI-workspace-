/**
 * Tailwind CSS v4 compatibility config for the Personal AI Studio tokens.
 * Loaded explicitly from src/index.css with: @config "../tailwind.config.js";
 */
export default {
  theme: {
    extend: {
      colors: {
        surface: 'var(--surface)',
        raised: 'var(--raised)',
        sunken: 'var(--sunken)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        faint: 'var(--faint)',
        border: 'var(--border)',
        signal: 'var(--signal)',
        'on-signal': 'var(--on-signal)',
        danger: 'var(--danger)',
        success: 'var(--success)',
        warning: 'var(--warning)',
      },
      fontFamily: {
        sans: ['var(--font-ui)'],
        ui: ['var(--font-ui)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        'type-1': ['var(--type-1)', { lineHeight: 'var(--type-1-line)' }],
        'type-2': ['var(--type-2)', { lineHeight: 'var(--type-2-line)' }],
        'type-3': ['var(--type-3)', { lineHeight: 'var(--type-3-line)' }],
        'type-4': ['var(--type-4)', { lineHeight: 'var(--type-4-line)' }],
        'type-5': ['var(--type-5)', { lineHeight: 'var(--type-5-line)' }],
        'type-6': ['var(--type-6)', { lineHeight: 'var(--type-6-line)' }],
        'type-7': ['var(--type-7)', { lineHeight: 'var(--type-7-line)' }],
      },
      spacing: {
        'space-1': 'var(--space-1)',
        'space-2': 'var(--space-2)',
        'space-3': 'var(--space-3)',
        'space-4': 'var(--space-4)',
        'space-5': 'var(--space-5)',
        'space-6': 'var(--space-6)',
        'space-7': 'var(--space-7)',
        'space-8': 'var(--space-8)',
        'space-9': 'var(--space-9)',
        'space-10': 'var(--space-10)',
        'space-11': 'var(--space-11)',
        'space-12': 'var(--space-12)',
      },
      borderRadius: {
        'radius-1': 'var(--radius-1)',
        'radius-2': 'var(--radius-2)',
        'radius-3': 'var(--radius-3)',
        'radius-4': 'var(--radius-4)',
        'radius-full': 'var(--radius-full)',
      },
      boxShadow: {
        'elevation-1': 'var(--shadow-1)',
        'elevation-2': 'var(--shadow-2)',
        'elevation-3': 'var(--shadow-3)',
      },
      transitionDuration: {
        'dur-1': 'var(--dur-1)',
        'dur-2': 'var(--dur-2)',
        'dur-3': 'var(--dur-3)',
        'dur-4': 'var(--dur-4)',
      },
      transitionTimingFunction: {
        'ease-out': 'var(--ease-out)',
        'ease-in': 'var(--ease-in)',
        'ease-in-out': 'var(--ease-in-out)',
        'ease-linear': 'var(--ease-linear)',
      },
    },
  },
};
