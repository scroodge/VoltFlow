# Установка VoltFlow на телефон

Рабочий адрес приложения: [https://voltflow.life/](https://voltflow.life/)

## iPhone и iPad

1. Откройте ссылку [https://voltflow.life/](https://voltflow.life/) в **Safari**.
2. Нажмите кнопку **Share** внизу экрана.
3. Выберите **Add to Home Screen**.
4. Оставьте название `VoltFlow` или задайте свое.
5. Нажмите **Add**.

После этого VoltFlow появится на домашнем экране и будет открываться как обычное приложение.

Если пункта **Add to Home Screen** нет, убедитесь, что страница открыта именно в Safari, а не во встроенном браузере Telegram, Instagram, Gmail или другого приложения.

## Android

1. Откройте ссылку [https://voltflow.life/](https://voltflow.life/) в **Chrome**.
2. Если Chrome предложит установить приложение, нажмите **Install**.
3. Если предложения нет, откройте меню Chrome.
4. Выберите **Install app** или **Add to Home screen**.
5. Подтвердите установку.

После установки VoltFlow появится на экране приложений и будет открываться в отдельном окне.

Если кнопки установки нет, откройте ссылку именно в Chrome. Встроенные браузеры приложений часто не показывают установку PWA.

## VoltFlow Mate на DiLink (шлюз телеметрии)

Для передачи live-данных с машины на сервер VoltFlow установите **VoltFlow Mate** на головное устройство BYD (репозиторий [BYDMate-own](https://github.com/scroodge/BYDMate-own)).

1. Зарегистрируйтесь в VoltFlow (ссылка выше) и откройте **Настройки → VoltFlow Mate**.
2. Нажмите **Подключить BYDMate** — появится **6-значный код** (10 минут).
3. В VoltFlow Mate на планшете: синхронизация VoltFlow → введите код → **Подключить**.
4. Укажите имя авто, отправьте тест, сохраните настройки.

Подробности: `supabase/BYDMATE_APK_API.md` в репозитории VoltFlow и README в репозитории VoltFlow Mate.
