export {};

export type ChecklistItem = {
  id: string;
  text: string;
  completed: boolean;
};

export type ChecklistState = {
  date: string;
  items: ChecklistItem[];
};

export type PreflightModeState = {
  mode: 'locked' | 'edit';
  locked: boolean;
  debug: boolean;
  overlay: boolean;
};

declare global {
  interface Window {
    preflight?: {
      platform: NodeJS.Platform;
      unlock: () => Promise<boolean>;
      getMode: () => Promise<PreflightModeState>;
      enterEditMode: () => Promise<PreflightModeState>;
      lockNow: () => Promise<PreflightModeState>;
      getState: () => Promise<ChecklistState>;
      setCompletion: (itemId: string, completed: boolean) => Promise<ChecklistState>;
      saveItems: (texts: string[]) => Promise<ChecklistState>;
      getStartupEnabled: () => Promise<boolean>;
      setStartupEnabled: (enabled: boolean) => Promise<boolean>;
    };
  }
}
