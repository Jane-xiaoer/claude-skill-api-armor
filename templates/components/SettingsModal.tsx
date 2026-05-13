/**
 * Drop-in Settings modal: master password + BYOK key, stored to localStorage.
 * Needs lucide-react. Add a state `[settingsOpen, setSettingsOpen]` and a
 * gear button somewhere in your app's chrome.
 *
 * Theming: uses Tailwind utility classes — tweak palette to match the project.
 */
import React, { useEffect, useState } from 'react';
import { X, Key, Sparkles } from 'lucide-react';
import { readMasterKey, readUserApiKey, saveSettings, currentMode } from '../lib/settings';

interface Props {
  open: boolean;
  onClose: () => void;
  lang?: 'en' | 'zh';
}

export const SettingsModal: React.FC<Props> = ({ open, onClose, lang = 'zh' }) => {
  const [masterKey, setMasterKey] = useState('');
  const [userApiKey, setUserApiKey] = useState('');
  const [mode, setMode] = useState<'master' | 'byok' | 'free'>('free');

  useEffect(() => {
    if (open) {
      setMasterKey(readMasterKey());
      setUserApiKey(readUserApiKey());
      setMode(currentMode());
    }
  }, [open]);

  if (!open) return null;

  const t = lang === 'zh' ? {
    title: '访问设置',
    masterLabel: '主密码（站长用）',
    masterHint: '正确填写后无限次使用',
    byokLabel: '自己的 API Key（BYOK）',
    byokHint: '以 AIza 开头（Gemini）或 sk- 开头（OpenAI），无限次使用，费用走你自己的账户',
    freeHint: '都不填 = 免费试用，每天 3 次',
    currentMode: '当前模式',
    modes: { master: '主控（无限）', byok: 'BYOK（无限，你付）', free: '免费（每天 3 次）' },
    save: '保存', cancel: '取消',
    getKey: '在 Google AI Studio 申请',
  } : {
    title: 'Access Settings',
    masterLabel: 'Master password (admin)',
    masterHint: 'Unlimited access if correct',
    byokLabel: 'Your own API Key (BYOK)',
    byokHint: 'Starts with AIza (Gemini) or sk- (OpenAI). Unlimited, billed to your account',
    freeHint: 'Leave blank = free trial, 3/day',
    currentMode: 'Current mode',
    modes: { master: 'Master (unlimited)', byok: 'BYOK (unlimited, you pay)', free: 'Free (3/day)' },
    save: 'Save', cancel: 'Cancel',
    getKey: 'Get a key at Google AI Studio',
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-800">
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-2xl font-bold mb-1 flex items-center gap-2">
          <Key className="w-5 h-5 text-amber-600" />
          {t.title}
        </h2>
        <p className="text-xs text-neutral-500 mb-5">
          {t.currentMode}: <span className="font-medium">{t.modes[mode]}</span>
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">{t.masterLabel}</label>
            <input
              type="password"
              value={masterKey}
              onChange={(e) => setMasterKey(e.target.value)}
              placeholder="••••"
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/40"
            />
            <p className="text-xs text-neutral-400 mt-1">{t.masterHint}</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">{t.byokLabel}</label>
            <input
              type="password"
              value={userApiKey}
              onChange={(e) => setUserApiKey(e.target.value)}
              placeholder="AIza... / sk-..."
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/40"
            />
            <p className="text-xs text-neutral-400 mt-1">
              {t.byokHint}{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-amber-600 hover:underline">
                {t.getKey}
              </a>
            </p>
          </div>

          <div className="text-xs text-neutral-400 flex items-center gap-1 pt-1">
            <Sparkles className="w-3 h-3" />
            {t.freeHint}
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-neutral-200 rounded-lg hover:bg-neutral-50 transition">
            {t.cancel}
          </button>
          <button
            onClick={() => { saveSettings(masterKey.trim(), userApiKey.trim()); onClose(); }}
            className="flex-1 px-4 py-2 bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 transition"
          >
            {t.save}
          </button>
        </div>
      </div>
    </div>
  );
};
