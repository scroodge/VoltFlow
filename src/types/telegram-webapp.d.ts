import type {
  TelegramSafeAreaInset,
  TelegramThemeParams,
  TelegramUser,
} from "@/lib/telegram/useTelegramWebApp";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        initDataUnsafe?: {
          user?: TelegramUser;
        };
        themeParams?: TelegramThemeParams;
        colorScheme?: "light" | "dark";
        viewportHeight?: number;
        viewportStableHeight?: number;
        platform?: string;
        safeAreaInset?: TelegramSafeAreaInset;
        contentSafeAreaInset?: TelegramSafeAreaInset;
        ready?: () => void;
        expand?: () => void;
        openLink?: (url: string) => void;
        onEvent?: (eventType: "viewportChanged", callback: () => void) => void;
        offEvent?: (eventType: "viewportChanged", callback: () => void) => void;
      };
    };
  }
}

export {};
