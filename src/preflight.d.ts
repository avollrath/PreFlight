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

declare global {
  interface Window {
    preflight?: {
      platform: NodeJS.Platform;
      unlock: () => Promise<boolean>;
      getState: () => Promise<ChecklistState>;
      setCompletion: (itemId: string, completed: boolean) => Promise<ChecklistState>;
      saveItems: (texts: string[]) => Promise<ChecklistState>;
      getStartupEnabled: () => Promise<boolean>;
      setStartupEnabled: (enabled: boolean) => Promise<boolean>;
    };
  }
}
