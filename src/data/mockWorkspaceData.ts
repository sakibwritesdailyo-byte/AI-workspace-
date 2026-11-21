import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_FAST_FALLBACK_MODEL,
  DEFAULT_LIVE_VOICE_MODEL,
} from '../shared/modelRegistry';
import type {
  AppSettings,
  Conversation,
  ModelSettings,
  Project,
  SystemPromptPreset,
  VoiceSettings,
} from '../types/workspace';

/**
 * Demonstration / sample templates strictly separated from real user IndexedDB data.
 * Never automatically merged into real user history or projects unless explicitly cloned by the user.
 */

export const SYSTEM_PROMPT_PRESETS: SystemPromptPreset[] = [
  {
    id: 'personal-architect',
    name: 'Personal Studio Architect',
    description: 'Concise engineering partner fluent in English and Bangla.',
    prompt:
      'You are my personal AI engineering partner. Keep answers direct, structured, and practical. Support seamless English and Bangla (বাংলা) conversation without unnecessary filler.',
  },
  {
    id: 'voice-concise',
    name: 'Voice-First Brief',
    description: 'Short spoken sentences tuned for real-time audio dialogue.',
    prompt:
      'Respond in natural spoken sentences suitable for voice playback. Keep turns concise, confirm intent clearly, and switch naturally between English and Bangla when asked.',
  },
  {
    id: 'code-reviewer',
    name: 'Code & Architecture Reviewer',
    description: 'Focuses on TypeScript, Kotlin Compose readiness, and edge cases.',
    prompt:
      'Review code for modularity, platform independence, type safety, and security boundaries. Highlight concrete fixes first.',
  },
];

export const SAMPLE_PROJECTS: Project[] = [
  {
    id: 'sample-dhaka-commute',
    name: 'Dhaka Commute Companion',
    description: 'Offline-ready metro & bus fare calculator built for quick one-thumb mobile lookup.',
    framework: 'HTML · CSS · Vanilla JS',
    createdAt: '2026-11-18T18:00:00Z',
    updatedAt: '2026-11-18T19:40:00Z',
    entryFileId: 'sample-dc-html',
    isSample: true,
    files: [
      {
        id: 'sample-dc-html',
        name: 'index.html',
        path: 'src/index.html',
        folder: 'src',
        language: 'html',
        updatedAt: '2026-11-18T19:40:00Z',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dhaka Commute Companion</title>
</head>
<body>
  <main class="shell">
    <header class="top">
      <p class="kicker">MRT Line 6 · Quick Estimator</p>
      <h1>Dhaka Metro Fare</h1>
    </header>

    <section class="card">
      <label class="field">
        <span>Origin Station</span>
        <select id="origin">
          <option value="0">Uttara North</option>
          <option value="2">Pallabi</option>
          <option value="5">Mirpur 10</option>
          <option value="8">Farmgate</option>
          <option value="11">Motijheel</option>
        </select>
      </label>

      <label class="field">
        <span>Destination Station</span>
        <select id="destination">
          <option value="8" selected>Farmgate</option>
          <option value="0">Uttara North</option>
          <option value="2">Pallabi</option>
          <option value="5">Mirpur 10</option>
          <option value="11">Motijheel</option>
        </select>
      </label>

      <div class="result" aria-live="polite">
        <div>
          <span class="label">Single Journey</span>
          <strong id="fare-single">BDT 60</strong>
        </div>
        <div>
          <span class="label">MRT Pass (10% off)</span>
          <strong id="fare-pass">BDT 54</strong>
        </div>
      </div>

      <button id="swap-btn" type="button">Swap Stations</button>
    </section>
  </main>
</body>
</html>`,
      },
      {
        id: 'sample-dc-css',
        name: 'styles.css',
        path: 'src/styles.css',
        folder: 'src',
        language: 'css',
        updatedAt: '2026-11-18T19:32:00Z',
        content: `:root {
  color-scheme: dark;
  font-family: system-ui, -apple-system, sans-serif;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background: #0b0e12;
  color: #edf2f7;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 20px;
}

.shell {
  width: 100%;
  max-width: 380px;
}

.top {
  margin-bottom: 18px;
}

.kicker {
  font-size: 12px;
  color: #34d399;
  margin-bottom: 4px;
  letter-spacing: 0.02em;
}

h1 {
  font-size: 24px;
  font-weight: 600;
}

.card {
  background: #131820;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 16px;
  padding: 18px;
  display: grid;
  gap: 14px;
}

.field {
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: #9aa5b4;
}

select {
  height: 44px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: #0b0e12;
  color: #edf2f7;
  padding: 0 12px;
  font-size: 14px;
}

.result {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 14px;
  background: #0b0e12;
  border-radius: 12px;
  border: 1px solid rgba(16, 185, 129, 0.25);
}

.label {
  display: block;
  font-size: 11px;
  color: #8b95a5;
  margin-bottom: 4px;
}

strong {
  font-size: 18px;
  color: #34d399;
  font-variant-numeric: tabular-nums;
}

button {
  height: 44px;
  border-radius: 10px;
  border: none;
  background: #10b981;
  color: #052e1e;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
}

button:hover {
  background: #34d399;
}`,
      },
      {
        id: 'sample-dc-js',
        name: 'app.js',
        path: 'src/app.js',
        folder: 'src',
        language: 'javascript',
        updatedAt: '2026-11-18T19:35:00Z',
        content: `const originEl = document.getElementById('origin');
const destEl = document.getElementById('destination');
const singleEl = document.getElementById('fare-single');
const passEl = document.getElementById('fare-pass');
const swapBtn = document.getElementById('swap-btn');

function updateFare() {
  const from = Number(originEl.value);
  const to = Number(destEl.value);
  const stops = Math.abs(to - from);
  const base = stops === 0 ? 20 : Math.min(100, 20 + stops * 5);
  const discounted = Math.round(base * 0.9);
  singleEl.textContent = \`BDT \${base}\`;
  passEl.textContent = \`BDT \${discounted}\`;
}

originEl.addEventListener('change', updateFare);
destEl.addEventListener('change', updateFare);
swapBtn.addEventListener('click', () => {
  const temp = originEl.value;
  originEl.value = destEl.value;
  destEl.value = temp;
  updateFare();
});

updateFare();`,
      },
      {
        id: 'sample-dc-readme',
        name: 'README.md',
        path: 'docs/README.md',
        folder: 'docs',
        language: 'markdown',
        updatedAt: '2026-11-18T18:10:00Z',
        content: `# Dhaka Commute Companion

Sample reference template for checking MRT Line 6 fares quickly offline.`,
      },
    ],
  },
  {
    id: 'sample-voice-notes',
    name: 'Bilingual Voice Memo Pad',
    description: 'Lightweight Bangla & English scratchpad template with live note entry.',
    framework: 'HTML · CSS · JS',
    createdAt: '2026-11-17T21:00:00Z',
    updatedAt: '2026-11-17T22:15:00Z',
    entryFileId: 'sample-vn-html',
    isSample: true,
    files: [
      {
        id: 'sample-vn-html',
        name: 'index.html',
        path: 'app/index.html',
        folder: 'app',
        language: 'html',
        updatedAt: '2026-11-17T22:15:00Z',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bilingual Memo Pad</title>
</head>
<body>
  <div class="pad">
    <h2>Quick Voice Note</h2>
    <p class="subtitle">আজকের কাজের তালিকা · Today's Focus</p>
    <ul id="list">
      <li>Finalize Android bottom sheet touch spacing</li>
      <li>মিরপুর থেকে ফিরে API টোকেন রোটেশন চেক করা</li>
    </ul>
    <form id="form">
      <input id="note-input" type="text" placeholder="Add a quick line..." />
      <button type="submit">Add</button>
    </form>
  </div>
</body>
</html>`,
      },
      {
        id: 'sample-vn-css',
        name: 'pad.css',
        path: 'app/pad.css',
        folder: 'app',
        language: 'css',
        updatedAt: '2026-11-17T22:00:00Z',
        content: `body {
  background: #0d1117;
  color: #e6edf3;
  font-family: system-ui, sans-serif;
  padding: 24px;
}

.pad {
  max-width: 420px;
  margin: 0 auto;
  background: #141a22;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 20px;
}

h2 { font-size: 18px; margin-bottom: 4px; }
.subtitle { font-size: 13px; color: #34d399; margin-bottom: 16px; }
ul { list-style: none; display: grid; gap: 10px; margin-bottom: 16px; }
li {
  padding: 10px 12px;
  background: #0d1117;
  border-radius: 8px;
  font-size: 14px;
}
form { display: flex; gap: 8px; }
input {
  flex: 1;
  height: 42px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: #0d1117;
  color: #fff;
}
button {
  height: 42px;
  padding: 0 16px;
  border-radius: 8px;
  border: none;
  background: #10b981;
  color: #042f20;
  font-weight: 600;
  cursor: pointer;
}`,
      },
      {
        id: 'sample-vn-js',
        name: 'pad.js',
        path: 'app/pad.js',
        folder: 'app',
        language: 'javascript',
        updatedAt: '2026-11-17T22:05:00Z',
        content: `const form = document.getElementById('form');
const input = document.getElementById('note-input');
const list = document.getElementById('list');

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = input.value.trim();
  if (!value) return;
  const item = document.createElement('li');
  item.textContent = value;
  list.appendChild(item);
  input.value = '';
});`,
      },
    ],
  },
];

export const SAMPLE_CONVERSATIONS: Conversation[] = [
  {
    id: 'sample-conv-architecture',
    title: 'Sample: Android PWA & Kotlin API Contract',
    kind: 'voice',
    projectId: null,
    createdAt: '2026-11-18T20:10:00Z',
    updatedAt: '2026-11-18T20:15:00Z',
    isPinned: false,
    durationSeconds: 214,
    isSample: true,
    summary:
      'Reference example demonstrating bilingual Bangla & English transcript structure.',
    messages: [
      {
        id: 'sample-msg-1',
        role: 'user',
        source: 'voice',
        language: 'mixed',
        timestamp: '20:11',
        content:
          'আমি চাই এই ওয়ার্কস্পেসটা আমার Android ফোনে PWA হিসেবে দারুণ চলুক, আর পরে যেন Kotlin Compose অ্যাপেও একই ব্যাকএন্ড ব্যবহার করা যায়।',
      },
      {
        id: 'sample-msg-2',
        role: 'assistant',
        source: 'voice',
        language: 'mixed',
        timestamp: '20:12',
        content:
          'একদম ঠিক সিদ্ধান্ত। ভয়েস এবং চ্যাট লজিক আলাদা সার্ভিস মডিউলে রাখা হচ্ছে যাতে PWA এবং ভবিষ্যতের Kotlin Compose ক্লায়েন্ট একই এন্ডপয়েন্ট ব্যবহার করতে পারে।',
      },
    ],
  },
  {
    id: 'sample-conv-bangla-notes',
    title: 'Sample: Bilingual Task Planning',
    kind: 'chat',
    projectId: null,
    createdAt: '2026-11-17T21:25:00Z',
    updatedAt: '2026-11-17T21:30:00Z',
    isPinned: false,
    isSample: true,
    summary: 'Reference text chat showing Bangla + English workflow notes.',
    messages: [
      {
        id: 'sample-msg-3',
        role: 'user',
        source: 'text',
        language: 'bn',
        timestamp: '21:28',
        content: 'বাংলা এবং ইংরেজি মিক্স করে লিখলে হিস্ট্রিতে ঠিকভাবে সেভ থাকবে তো?',
      },
      {
        id: 'sample-msg-4',
        role: 'assistant',
        source: 'text',
        language: 'bn',
        timestamp: '21:30',
        content: 'হ্যাঁ, সব টেক্সট ও ট্রান্সক্রিপ্ট UTF-8 ফরম্যাটে লোকাল IndexedDB-তে সংরক্ষিত থাকে।',
      },
    ],
  },
];

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  voiceName: 'Aoede',
  languageMode: 'bilingual',
  allowBargeIn: true,
  saveTranscripts: true,
  saveRawAudio: false,
  speechRate: 1.0,
};

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  chatModel: DEFAULT_CHAT_MODEL,
  liveModel: DEFAULT_LIVE_VOICE_MODEL,
  fallbackModel: DEFAULT_FAST_FALLBACK_MODEL,
  temperature: 0.4,
  thinkingLevel: 'auto',
  maxOutputTokens: 4096,
  systemPromptId: SYSTEM_PROMPT_PRESETS[0].id,
  customSystemPrompt: SYSTEM_PROMPT_PRESETS[0].prompt,
  autoFallback: true,
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  showLineNumbers: true,
  autosaveEnabled: true,
  localFirstMode: true,
};
