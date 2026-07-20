import type { Locale } from "@/lib/i18n";
import type { LegalDocument, LegalOperatorDetails } from "@/content/legal/types";

const UPDATED = "2026-07-20";

const en = (op: LegalOperatorDetails): LegalDocument => ({
  title: "Privacy Policy (International)",
  updatedAt: UPDATED,
  sections: [
    {
      title: "Who we are",
      paragraphs: [
        `${op.name} (“we”, “us”) operates the VoltFlow web application and related services (the “Service”). This policy explains how we handle personal data when you use VoltFlow outside Belarus-specific arrangements.`,
        `Contact for privacy requests: ${op.email}.`,
      ],
    },
    {
      title: "What we collect",
      bullets: [
        "Account data: email address and authentication identifiers from Supabase Auth.",
        "Vehicle profiles: nickname, battery capacity, charger power, home geofence coordinates you enter.",
        "Charging sessions: start/stop times, SOC, energy, tariff, and cost estimates.",
        "VoltFlow Mate telemetry when enabled: battery state, speeds, temperatures, odometer, trip tracks, and GPS when your car tablet grants location permission.",
        "Device preferences: language, currency, and default tariff stored locally and in your profile.",
        "Push notification subscription endpoints if you enable web push.",
      ],
    },
    {
      title: "Why we use data",
      bullets: [
        "Provide charging session tracking, ETA, and cost modelling.",
        "Sync live vehicle telemetry and trip history to your account.",
        "Secure your account and enforce per-user data isolation.",
        "Send optional charging notifications.",
        "Improve reliability and diagnose technical issues.",
      ],
    },
    {
      title: "Legal bases (where applicable)",
      paragraphs: [
        "Where GDPR or similar laws apply, we rely on contract performance (providing the Service), legitimate interests (security, analytics, product improvement), and consent where required (for example optional push or precise geolocation from Mate).",
      ],
    },
    {
      title: "Processors and hosting",
      bullets: [
        "Supabase — authentication, database, and realtime (EU/US regions depending on project configuration).",
        "Vercel — application hosting.",
        "Optional: web push infrastructure; OpenAI when knowledge-base semantic search is enabled for your deployment.",
      ],
    },
    {
      title: "Retention",
      paragraphs: [
        "We keep account and session data while your account is active. Raw telemetry retention policy is tiered: Free plan keeps 30 days of raw telemetry/tracks; Premium retains them indefinitely while the account remains active. Hourly aggregated telemetry can be kept longer for analytics.",
        "For the Free plan, when raw telemetry retention is exceeded, records are deleted during scheduled cleanup and cannot be restored.",
        "Inactive accounts: if you do not log in or send telemetry for 30 days, we will send a warning email. If no activity occurs within 60 days, your account and all associated data will be permanently deleted. Premium users are exempt while their Premium status is active.",
        "You may request deletion of your account and associated data by contacting us.",
      ],
    },
    {
      title: "Security",
      paragraphs: [
        "Data is transmitted over HTTPS. Database access is scoped so each signed-in user can only read and update their own rows. Service credentials are not stored on your phone beyond your session tokens.",
      ],
    },
    {
      title: "Your rights",
      bullets: [
        "Access, correction, and deletion of personal data we hold about you.",
        "Export of charging history and related account data where technically feasible.",
        "Withdraw consent for optional features without affecting core session tracking where another legal basis applies.",
        "Lodge a complaint with your local data protection authority where applicable.",
      ],
    },
    {
      title: "Children",
      paragraphs: [
        "VoltFlow is not directed at children under 16. We do not knowingly collect data from children.",
      ],
    },
    {
      title: "Changes",
      paragraphs: [
        `We may update this policy. The “Last updated” date at the bottom reflects the latest version. Continued use after changes constitutes acceptance where permitted by law.`,
      ],
    },
  ],
});

const be = (op: LegalOperatorDetails): LegalDocument => ({
  title: "Палітыка прыватнасці (міжнародная)",
  updatedAt: UPDATED,
  sections: [
    {
      title: "Хто мы",
      paragraphs: [
        `${op.name} («мы») кіруе вэб-праграмай VoltFlow і супутнімі сэрвісамі («Сэрвіс»). Гэтая палітыка тлумачыць, як мы апрацоўваем персанальныя даныя пры выкарыстанні VoltFlow па-за беларускімі ўмовамі.`,
        `Кантакт для запытаў аб прыватнасці: ${op.email}.`,
      ],
    },
    {
      title: "Што мы збіраем",
      bullets: [
        "Даныя акаўнта: email і ідэнтыфікатары аўтарызацыі Supabase.",
        "Профілі аўто: назва, ёмістасць батарэі, магутнасць зарадкі, каардынаты домашняй геазоны.",
        "Зарадныя сесіі: час, SOC, энергія, тарыф і кошт.",
        "Тэлеметрыя VoltFlow Mate: стан батарэі, хуткасць, тэмпературы, адометр, паездкі і GPS пры дазволе на планшэце.",
        "Налады: мова, валюта, тарыф.",
        "Push-падпіскі, калі ўключаны вэб-push.",
      ],
    },
    {
      title: "Навошта выкарыстоўваем",
      bullets: [
        "Улік зарадкі, ETA і кошту.",
        "Сінхранізацыя тэлеметрыі і гісторыі паездак.",
        "Бяспека акаўнта і ізаляцыя даных карыстальніка.",
        "Апавяшчэнні пра зарадку (па жаданні).",
        "Паляпшэнне надзейнасці сэрвісу.",
      ],
    },
    {
      title: "Прававыя падставы",
      paragraphs: [
        "Дзе дзейнічаюць GDPR або аналагічныя нормы, мы апіраемся на выкананне дагавора, законныя інтарэсы (бяспека, аналітыка) і згоду, калі яна патрэбна (push, геалакацыя Mate).",
      ],
    },
    {
      title: "Апрацоўшчыкі",
      bullets: [
        "Supabase — аўтэнтыфікацыя, база даных, realtime.",
        "Vercel — хостинг.",
        "Дадаткова: push-інфраструктура; OpenAI пры семантычным пошуку базы ведаў.",
      ],
    },
    {
      title: "Захоўванне",
      paragraphs: [
        "Даныя акаўнта захоўваюцца, пакуль акаўнт актыўны. Палітыка сырых даных ступенчатая: free-план — 30 дзён сырай тэлеметрыі/трэкаў; Premium захоўвае іх бестэрмінова, пакуль акаўнт актыўны. Пагадзінныя агрэгацыі могуць захоўвацца даўжэй для аналітыкі.",
        "Для free-плана пасля дасягнення тэрміну захоўвання сырыя запісы выдаляюцца падчас планавых ачыстак і не могуць быць адноўлены.",
        "Неактыўныя акаўнты: калі вы не ўваходзіце ў сістэму або не дасылаеце тэлеметрыю на працягу 30 дзён, мы дашлем папярэджанне на email. Калі актыўнасць не аднавіцца на працягу 60 дзён, ваш акаўнт і ўсе звязаныя даныя будуць выдалены назаўжды. Прэміум-карыстальнікі вызваляюцца, пакуль іх прэміум-статус актыўны.",
        "Вы можаце запытаць выдаленне акаўнта, звязаўшыся з намі.",
      ],
    },
    {
      title: "Бяспека",
      paragraphs: [
        "Перадача праз HTTPS. Доступ да базы абмежаваны вашым акаўнтам. Сервісныя ключы не захоўваюцца на тэлефоне.",
      ],
    },
    {
      title: "Вашы правы",
      bullets: [
        "Доступ, выпраўленне і выдаленне даных.",
        "Экспарт гісторыі зарадкі, дзе магчыма.",
        "Адкліканне згоды на дадатковыя функцыі.",
        "Скарга ў мясцовы орган па абароне даных, калі прымяняецца.",
      ],
    },
    {
      title: "Дзеці",
      paragraphs: ["VoltFlow не прызначаны для дзяцей малады за 16 гадоў."],
    },
    {
      title: "Змены",
      paragraphs: [
        "Мы можам абнавіць палітыку. Дата «Абноўлена» ўнізе паказвае актуальную версію.",
      ],
    },
  ],
});

const ru = (op: LegalOperatorDetails): LegalDocument => ({
  title: "Политика конфиденциальности (международная)",
  updatedAt: UPDATED,
  sections: [
    {
      title: "Кто мы",
      paragraphs: [
        `${op.name} («мы») управляет веб-приложением VoltFlow и связанными сервисами («Сервис»). Эта политика объясняет обработку персональных данных при использовании VoltFlow вне белорусского варианта.`,
        `Контакт для запросов о конфиденциальности: ${op.email}.`,
      ],
    },
    {
      title: "Что мы собираем",
      bullets: [
        "Данные аккаунта: email и идентификаторы Supabase Auth.",
        "Профили авто: название, ёмкость батареи, мощность зарядки, координаты домашней геозоны.",
        "Зарядные сессии: время, SOC, энергия, тариф и стоимость.",
        "Телеметрия VoltFlow Mate: состояние батареи, скорость, температуры, одометр, поездки и GPS при разрешении на планшете.",
        "Настройки: язык, валюта, тариф.",
        "Push-подписки при включённом web push.",
      ],
    },
    {
      title: "Зачем используем",
      bullets: [
        "Учёт зарядки, ETA и стоимости.",
        "Синхронизация телеметрии и истории поездок.",
        "Безопасность аккаунта и изоляция данных пользователя.",
        "Уведомления о зарядке (по желанию).",
        "Улучшение надёжности сервиса.",
      ],
    },
    {
      title: "Правовые основания",
      paragraphs: [
        "Где применимы GDPR или аналогичные нормы, мы опираемся на исполнение договора, законные интересы (безопасность, аналитика) и согласие, когда оно требуется (push, геолокация Mate).",
      ],
    },
    {
      title: "Обработчики",
      bullets: [
        "Supabase — аутентификация, база данных, realtime.",
        "Vercel — хостинг.",
        "Дополнительно: push-инфраструктура; OpenAI при семантическом поиске базы знаний.",
      ],
    },
    {
      title: "Хранение",
      paragraphs: [
        "Данные аккаунта хранятся, пока аккаунт активен. Политика по сырым данным ступенчатая: free-план — 30 дней сырой телеметрии/треков; Premium хранит их бессрочно, пока аккаунт активен. Почасовые агрегаты могут храниться дольше для аналитики.",
        "Для free-плана после истечения срока хранения сырые записи удаляются в плановых очистках и восстановлению не подлежат.",
        "Неактивные аккаунты: если вы не входите в систему или не отправляете телеметрию в течение 30 дней, мы отправим предупреждение по email. Если активность не возобновится в течение 60 дней, ваш аккаунт и все связанные данные будут безвозвратно удалены. Премиум-пользователи освобождаются, пока их премиум-статус активен.",
        "Вы можете запросить удаление аккаунта, связавшись с нами.",
      ],
    },
    {
      title: "Безопасность",
      paragraphs: [
        "Передача по HTTPS. Доступ к базе ограничен вашим аккаунтом. Сервисные ключи не хранятся на телефоне.",
      ],
    },
    {
      title: "Ваши права",
      bullets: [
        "Доступ, исправление и удаление данных.",
        "Экспорт истории зарядки, где возможно.",
        "Отзыв согласия на дополнительные функции.",
        "Жалоба в местный орган по защите данных, если применимо.",
      ],
    },
    {
      title: "Дети",
      paragraphs: ["VoltFlow не предназначен для детей младше 16 лет."],
    },
    {
      title: "Изменения",
      paragraphs: [
        "Мы можем обновить политику. Дата «Обновлено» внизу указывает актуальную версию.",
      ],
    },
  ],
});

const byLocale: Record<Locale, (op: LegalOperatorDetails) => LegalDocument> = {
  en,
  be,
  ru,
};

export function getPrivacyWorld(
  locale: Locale,
  operator: LegalOperatorDetails,
): LegalDocument {
  return byLocale[locale](operator);
}
