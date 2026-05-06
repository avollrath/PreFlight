export {};

declare global {
  interface Window {
    preflight?: {
      platform: NodeJS.Platform;
      unlock: () => Promise<boolean>;
    };
  }
}
