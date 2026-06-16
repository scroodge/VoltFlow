import type { Locale } from "@/lib/i18n";
import type { LegalDocument, LegalOperatorDetails } from "@/content/legal/types";

const UPDATED = "2026-06-16";

const en = (op: LegalOperatorDetails): LegalDocument => ({
  title: "Privacy Policy (Belarus)",
  updatedAt: UPDATED,
  sections: [
    {
      title: "Operator",
      paragraphs: [
        `${op.name}, ${op.address}, operates VoltFlow (“Сервис”) for users in the Republic of Belarus.`,
        `This policy is prepared in accordance with the Law of the Republic of Belarus No. 99-Z of 7 May 2021 “On Personal Data Protection” (as amended).`,
        `Privacy contact: ${op.email}.`,
      ],
    },
    {
      title: "Categories of personal data",
      bullets: [
        "Identification and contact data: email address.",
        "Vehicle and charging data: car profiles, session history, tariffs, cost estimates.",
        "Telemetry from VoltFlow Mate: battery metrics, trip routes, speeds, diagnostics; geolocation when permission is granted on the car tablet.",
        "Technical data: authentication tokens, push endpoints, language and currency preferences.",
      ],
    },
    {
      title: "Purposes of processing",
      bullets: [
        "Registration, authentication, and account management.",
        "Providing charging planning, history, and vehicle analytics.",
        "Applying home-charger geofence tariffs you configure.",
        "Ensuring information security and preventing unauthorized access.",
        "Optional notifications about charging events.",
      ],
    },
    {
      title: "Legal grounds",
      paragraphs: [
        "Processing is based on your consent when you create an account and enable VoltFlow Mate sync, performance of the user agreement, and compliance with legal obligations where applicable.",
        "Geolocation from Mate is processed only after permission is granted on the Android device in the vehicle.",
      ],
    },
    {
      title: "Cross-border transfer",
      paragraphs: [
        "Personal data may be stored and processed using cloud infrastructure (Supabase, Vercel) located outside the Republic of Belarus. By using the Service you acknowledge such transfer is necessary to provide the Service. We apply contractual and technical safeguards with processors.",
      ],
    },
    {
      title: "Retention",
      paragraphs: [
        "Data is retained for the life of your account and as needed for history, analytics, and legal compliance. You may request erasure subject to limits of applicable law and technical feasibility.",
      ],
    },
    {
      title: "Your rights under Belarus law",
      bullets: [
        "Receive information about processing of your personal data.",
        "Request correction of inaccurate data.",
        "Request deletion when grounds under Law No. 99-Z are met.",
        "Withdraw consent for processing based on consent.",
        "Contact us at the email above; you may also refer to the national authority for personal data protection in Belarus regarding lawful procedures.",
      ],
    },
    {
      title: "Security measures",
      paragraphs: [
        "HTTPS encryption, authenticated access, per-user data isolation in the database, and absence of service-role credentials on end-user devices.",
      ],
    },
    {
      title: "Children",
      paragraphs: [
        "The Service is not intended for minors without parental consent as required by applicable law.",
      ],
    },
    {
      title: "Updates",
      paragraphs: [
        `We may amend this policy. Material changes will be reflected by updating the date below.`,
      ],
    },
  ],
});

const be = (op: LegalOperatorDetails): LegalDocument => ({
  title: "Палітыка прыватнасці (Беларусь)",
  updatedAt: UPDATED,
  sections: [
    {
      title: "Аператар",
      paragraphs: [
        `${op.name}, ${op.address}, кіруе VoltFlow («Сэрвіс») для карыстальнікаў у Рэспубліцы Беларусь.`,
        `Палітыка падрыхтавана ў адпаведнасці з Законам Рэспублікі Беларусь ад 7 мая 2021 г. № 99-З «Аб абароне персанальных даных» (у рэдакцыі на дату абнаўлення).`,
        `Кантакт па пытаннях персанальных даных: ${op.email}.`,
      ],
    },
    {
      title: "Катэгорыі персанальных даных",
      bullets: [
        "Ідэнтыфікацыйныя і кантактныя даныя: адрас электроннай пошты.",
        "Даныя аб аўто і зарадцы: профілі, гісторыя сесій, тарыфы, кошты.",
        "Тэлеметрыя VoltFlow Mate: паказчыкі батарэі, маршруты, хуткасць, дыягностыка; геалакацыя пры дазволе на планшэце.",
        "Тэхнічныя даныя: токены аўтарызацыі, push-каналы, мова і валюта.",
      ],
    },
    {
      title: "Мэты апрацоўкі",
      bullets: [
        "Рэгістрацыя, аўтарызацыя і кіраванне акаўнтам.",
        "Планаванне зарадкі, гісторыя і аналітыка аўто.",
        "Прымяненне домашняга тарыфу ў геазоне.",
        "Забеспячэнне бяспекі інфармацыі.",
        "Апавяшчэнні пра зарадку (па жаданні).",
      ],
    },
    {
      title: "Прававыя падставы",
      paragraphs: [
        "Апрацоўка заснавана на згодзе пры стварэнні акаўнта і ўключэнні сінхранізацыі Mate, выкананні карыстальніцкага пагаднення і выкананні законных абавязкаў.",
        "Геалакацыя з Mate апрацоўваецца толькі пасля дазволу на прладзе Android у аўто.",
      ],
    },
    {
      title: "Трансгранічная перадача",
      paragraphs: [
        "Персанальныя даныя могуць захоўвацца і апрацоўвацца з выкарыстаннем воблачнай інфраструктуры (Supabase, Vercel) за межамі Рэспублікі Беларусь. Выкарыстоўваючы Сэрвіс, вы пацвярджаеце, што такая перадача неабходная для яго працы. Мы прымяняем дагаворныя і тэхнічныя меры з апрацоўшчыкамі.",
      ],
    },
    {
      title: "Тэрміны захоўвання",
      paragraphs: [
        "Даныя захоўваюцца на працягу існавання акаўнта і столькі, колькі патрэбна для гісторыі, аналітыкі і выканання закона. Вы можаце запытаць выдаленне ў межах закону і тэхнічных магчымасцей.",
      ],
    },
    {
      title: "Вашы правы",
      bullets: [
        "Атрымаць інфармацыю аб апрацоўцы вашых даных.",
        "Запатрабаваць выпраўленне неточных даных.",
        "Запатрабаваць выдаленне пры наяўнасці падставаў па Закону № 99-З.",
        "Адклікаць згоду, калі апрацоўка заснавана на згодзе.",
        "Звярнуцца да нас па email вышэй; таксама магчымы законныя шляхі звароту ў орган па абароне персанальных даных РБ.",
      ],
    },
    {
      title: "Меры бяспекі",
      paragraphs: [
        "Шифраванне HTTPS, аўтэнтыфікаваны доступ, ізаляцыя даных карыстальніка ў базе, адсутнасць service-role ключоў на прыладах карыстальніка.",
      ],
    },
    {
      title: "Непаўналетнія",
      paragraphs: [
        "Сэрвіс не прызначаны для непаўналетніх без згоды законных прадстаўнікоў, калі гэта патрабуецца законам.",
      ],
    },
    {
      title: "Змены",
      paragraphs: ["Мы можам змяніць палітыку; дата ніжэй адлюстроўвае актуальную версію."],
    },
  ],
});

const ru = (op: LegalOperatorDetails): LegalDocument => ({
  title: "Политика конфиденциальности (Беларусь)",
  updatedAt: UPDATED,
  sections: [
    {
      title: "Оператор",
      paragraphs: [
        `${op.name}, ${op.address}, управляет VoltFlow («Сервис») для пользователей в Республике Беларусь.`,
        `Политика подготовлена в соответствии с Законом Республики Беларусь от 7 мая 2021 г. № 99-З «О защите персональных данных» (в редакции на дату обновления).`,
        `Контакт по персональным данным: ${op.email}.`,
      ],
    },
    {
      title: "Категории персональных данных",
      bullets: [
        "Идентификационные и контактные данные: адрес электронной почты.",
        "Данные об авто и зарядке: профили, история сессий, тарифы, стоимость.",
        "Телеметрия VoltFlow Mate: показатели батареи, маршруты, скорость, диагностика; геолокация при разрешении на планшете.",
        "Технические данные: токены авторизации, push-каналы, язык и валюта.",
      ],
    },
    {
      title: "Цели обработки",
      bullets: [
        "Регистрация, авторизация и управление аккаунтом.",
        "Планирование зарядки, история и аналитика авто.",
        "Применение домашнего тарифа в геозоне.",
        "Обеспечение информационной безопасности.",
        "Уведомления о зарядке (по желанию).",
      ],
    },
    {
      title: "Правовые основания",
      paragraphs: [
        "Обработка основана на согласии при создании аккаунта и включении синхронизации Mate, исполнении пользовательского соглашения и исполнении законных обязанностей.",
        "Геолокация с Mate обрабатывается только после разрешения на устройстве Android в автомобиле.",
      ],
    },
    {
      title: "Трансграничная передача",
      paragraphs: [
        "Персональные данные могут храниться и обрабатываться с использованием облачной инфраструктуры (Supabase, Vercel) за пределами Республики Беларусь. Используя Сервис, вы подтверждаете, что такая передача необходима для его работы. Мы применяем договорные и технические меры с обработчиками.",
      ],
    },
    {
      title: "Сроки хранения",
      paragraphs: [
        "Данные хранятся в течение существования аккаунта и столько, сколько нужно для истории, аналитики и исполнения закона. Вы можете запросить удаление в пределах закона и технических возможностей.",
      ],
    },
    {
      title: "Ваши права",
      bullets: [
        "Получить информацию об обработке ваших данных.",
        "Требовать исправления неточных данных.",
        "Требовать удаления при наличии оснований по Закону № 99-З.",
        "Отозвать согласие, если обработка основана на согласии.",
        "Обратиться к нам по email выше; также возможны законные пути обращения в орган по защите персональных данных РБ.",
      ],
    },
    {
      title: "Меры безопасности",
      paragraphs: [
        "Шифрование HTTPS, аутентифицированный доступ, изоляция данных пользователя в базе, отсутствие service-role ключей на устройствах пользователя.",
      ],
    },
    {
      title: "Несовершеннолетние",
      paragraphs: [
        "Сервис не предназначен для несовершеннолетних без согласия законных представителей, если это требуется законом.",
      ],
    },
    {
      title: "Изменения",
      paragraphs: ["Мы можем изменить политику; дата ниже отражает актуальную версию."],
    },
  ],
});

const byLocale: Record<Locale, (op: LegalOperatorDetails) => LegalDocument> = {
  en,
  be,
  ru,
};

export function getPrivacyBelarus(
  locale: Locale,
  operator: LegalOperatorDetails,
): LegalDocument {
  return byLocale[locale](operator);
}
