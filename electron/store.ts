import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const { app } = require('electron') as typeof import('electron');

export type ChecklistItem = {
  id: string;
  text: string;
};

export type ChecklistState = {
  date: string;
  items: Array<ChecklistItem & { completed: boolean }>;
};

type StoreData = {
  items: ChecklistItem[];
  completionsByDate: Record<string, string[]>;
  settings: {
    startOnStartupWake: boolean;
    blockSecondaryScreens: boolean;
  };
};

const storePath = path.join(app.getPath('userData'), 'preflight-store.json');

function todayKey() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function createDefaultStore(): StoreData {
  return {
    items: [],
    completionsByDate: {},
    settings: {
      startOnStartupWake: false,
      blockSecondaryScreens: true
    }
  };
}

function readStore(): StoreData {
  try {
    const raw = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoreData>;

    if (!Array.isArray(parsed.items)) {
      return createDefaultStore();
    }

    return {
      items: parsed.items,
      completionsByDate: parsed.completionsByDate ?? {},
      settings: {
        startOnStartupWake: parsed.settings?.startOnStartupWake ?? false,
        blockSecondaryScreens: parsed.settings?.blockSecondaryScreens ?? true
      }
    };
  } catch {
    return createDefaultStore();
  }
}

function writeStore(data: StoreData) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2));
}

export function getChecklistState(): ChecklistState {
  const data = readStore();
  const date = todayKey();
  const completed = new Set(data.completionsByDate[date] ?? []);

  return {
    date,
    items: data.items.map((item) => ({
      ...item,
      completed: completed.has(item.id)
    }))
  };
}

export function setChecklistItemCompletion(itemId: string, completed: boolean) {
  const data = readStore();
  const date = todayKey();
  const completedItems = new Set(data.completionsByDate[date] ?? []);

  if (completed) {
    completedItems.add(itemId);
  } else {
    completedItems.delete(itemId);
  }

  data.completionsByDate[date] = Array.from(completedItems);
  writeStore(data);

  return getChecklistState();
}

export function saveChecklistItems(texts: string[]) {
  const existing = readStore();
  const previousByText = new Map(existing.items.map((item) => [item.text, item.id]));
  const items = texts
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({
      id: previousByText.get(text) ?? randomUUID(),
      text
    }));

  const data: StoreData = {
    items,
    completionsByDate: existing.completionsByDate,
    settings: existing.settings
  };

  writeStore(data);
  return getChecklistState();
}

export function getStartOnStartupWakeEnabled() {
  return readStore().settings.startOnStartupWake;
}

export function setStartOnStartupWakeEnabled(enabled: boolean) {
  const data = readStore();
  data.settings.startOnStartupWake = enabled;
  writeStore(data);
  return data.settings.startOnStartupWake;
}

export function getBlockSecondaryScreensEnabled() {
  return readStore().settings.blockSecondaryScreens;
}

export function setBlockSecondaryScreensEnabled(enabled: boolean) {
  const data = readStore();
  data.settings.blockSecondaryScreens = enabled;
  writeStore(data);
  return data.settings.blockSecondaryScreens;
}
