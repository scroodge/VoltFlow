import type { Locale } from "@/lib/i18n";
import type { LegalDocument, LegalOperatorDetails } from "@/content/legal/types";

const UPDATED = "2026-06-16";

const en = (op: LegalOperatorDetails): LegalDocument => ({
  title: "Terms of Service (International)",
  updatedAt: UPDATED,
  sections: [
    {
      title: "Agreement",
      paragraphs: [
        `These Terms govern your use of VoltFlow operated by ${op.name} (“we”). By creating an account or using the Service you agree to these Terms.`,
      ],
    },
    {
      title: "The Service",
      paragraphs: [
        "VoltFlow is a planning and tracking cockpit for EV charging. It models session progress, energy, and cost from timestamps and telemetry. VoltFlow does not communicate with or control charger hardware, wallboxes, or your vehicle directly.",
        "Always verify physical charger state, cables, and vehicle indicators on site.",
      ],
    },
    {
      title: "Your account",
      bullets: [
        "You must provide accurate registration information and keep credentials secure.",
        "You are responsible for activity under your account.",
        "You must not attempt to access other users’ data or disrupt the Service.",
      ],
    },
    {
      title: "VoltFlow Mate",
      paragraphs: [
        "Optional Android software on your BYD head unit sends telemetry you configure. You are responsible for permissions granted on the car tablet and compliance with vehicle and local rules.",
      ],
    },
    {
      title: "Acceptable use",
      bullets: [
        "No unlawful, abusive, or automated scraping that harms the Service.",
        "No reverse engineering intended to bypass security or quotas.",
        "No misrepresentation of telemetry or session data.",
      ],
    },
    {
      title: "Disclaimer",
      paragraphs: [
        "The Service is provided “as is”. Estimates (ETA, kWh, cost) are indicative and may differ from real-world charging. We disclaim warranties to the fullest extent permitted by law.",
      ],
    },
    {
      title: "Limitation of liability",
      paragraphs: [
        "To the maximum extent permitted by law, we are not liable for indirect, incidental, or consequential damages, or for charging incidents, property damage, or energy billing disputes arising from reliance on estimates.",
      ],
    },
    {
      title: "Termination",
      paragraphs: [
        "You may stop using the Service and request account deletion. We may suspend access for breach of these Terms or to protect the Service.",
      ],
    },
    {
      title: "Changes",
      paragraphs: [
        "We may update these Terms. Continued use after the updated date constitutes acceptance where allowed by law.",
      ],
    },
    {
      title: "Contact",
      paragraphs: [`Questions: ${op.email}.`],
    },
  ],
});

const be = (op: LegalOperatorDetails): LegalDocument => ({
  title: "Умовы карыстання (міжнародныя)",
  updatedAt: UPDATED,
  sections: [
    {
      title: "Пагадненне",
      paragraphs: [
        `Гэтыя Умовы рэгулююць выкарыстанне VoltFlow, якім кіруе ${op.name} («мы»). Ствараючы акаўнт або карыстаючыся Сэрвісам, вы згаджаецеся з Умовамі.`,
      ],
    },
    {
      title: "Сэрвіс",
      paragraphs: [
        "VoltFlow — панэль планавання і ўліку зарадкі. Ён мадэлюе прагрэс, энергію і кошт па часу і тэлеметрыі. VoltFlow не кіруе зарадным абсталяваннем і аўто напрамую.",
        "Заўсёды правярайце стан зарадкі, кабеляў і паказчыкаў аўто на месцы.",
      ],
    },
    {
      title: "Ваш акаўнт",
      bullets: [
        "Дакладныя рэгістрацыйныя даныя і бяспека ўліковых даных.",
        "Адказнасць за дзеянні пад вашым акаўнтам.",
        "Забарона доступу да чужых даных і парушэнняў работы Сэрвісу.",
      ],
    },
    {
      title: "VoltFlow Mate",
      paragraphs: [
        "Неабавязковае Android-ПЗ на галоўным экране BYD дасылае наладжаную вамі тэлеметрыю. Вы адказваеце за дазволы на планшэце і выкананне мясцовых правіл.",
      ],
    },
    {
      title: "Дапушчальнае выкарыстанне",
      bullets: [
        "Без незаконнай, абusive або шкоднай аўтаматызацыі.",
        "Без абходу бяспекі.",
        "Без фальсіфікацыі тэлеметрыі або сесій.",
      ],
    },
    {
      title: "Адмова ад гарантый",
      paragraphs: [
        "Сэрвіс прадастаўляецца «як ёсць». Ацэнкі (ETA, кВт·г, кошт) з’яўляюцца арыентавальнымі. Гарантыі адхіляюцца ў максімальнай дазволенай законам меры.",
      ],
    },
    {
      title: "Абмежаванне адказнасці",
      paragraphs: [
        "У максімальнай дазволенай меры мы не адказваем за ўскосныя страты, інцыдэнты на зарадцы або споры па лічэннях за энергію з-за разлікаў.",
      ],
    },
    {
      title: "Спыненне",
      paragraphs: [
        "Вы можаце спыніць выкарыстанне і запытаць выдаленне акаўнта. Мы можам прыпыніць доступ пры парушэнні Умоў.",
      ],
    },
    {
      title: "Змены",
      paragraphs: ["Мы можам абнавіць Умовы; працяг выкарыстання можа азначаць згоду, калі дазволена законам."],
    },
    {
      title: "Кантакт",
      paragraphs: [`Пытанні: ${op.email}.`],
    },
  ],
});

const ru = (op: LegalOperatorDetails): LegalDocument => ({
  title: "Условия использования (международные)",
  updatedAt: UPDATED,
  sections: [
    {
      title: "Соглашение",
      paragraphs: [
        `Настоящие Условия регулируют использование VoltFlow, которым управляет ${op.name} («мы»). Создавая аккаунт или используя Сервис, вы соглашаетесь с Условиями.`,
      ],
    },
    {
      title: "Сервис",
      paragraphs: [
        "VoltFlow — панель планирования и учёта зарядки. Он моделирует прогресс, энергию и стоимость по времени и телеметрии. VoltFlow не управляет зарядным оборудованием и автомобилем напрямую.",
        "Всегда проверяйте состояние зарядки, кабелей и показателей авто на месте.",
      ],
    },
    {
      title: "Ваш аккаунт",
      bullets: [
        "Точные регистрационные данные и безопасность учётных данных.",
        "Ответственность за действия под вашим аккаунтом.",
        "Запрет доступа к чужим данным и нарушений работы Сервиса.",
      ],
    },
    {
      title: "VoltFlow Mate",
      paragraphs: [
        "Необязательное Android-ПО на головном устройстве BYD отправляет настроенную вами телеметрию. Вы отвечаете за разрешения на планшете и соблюдение местных правил.",
      ],
    },
    {
      title: "Допустимое использование",
      bullets: [
        "Без незаконной, вредоносной или разрушительной автоматизации.",
        "Без обхода безопасности.",
        "Без фальсификации телеметрии или сессий.",
      ],
    },
    {
      title: "Отказ от гарантий",
      paragraphs: [
        "Сервис предоставляется «как есть». Оценки (ETA, кВт·ч, стоимость) ориентировочны. Гарантии исключаются в максимально допустимой законом мере.",
      ],
    },
    {
      title: "Ограничение ответственности",
      paragraphs: [
        "В максимально допустимой мере мы не отвечаем за косвенные убытки, инциденты на зарядке или споры по счетам за энергию из-за расчётов.",
      ],
    },
    {
      title: "Прекращение",
      paragraphs: [
        "Вы можете прекратить использование и запросить удаление аккаунта. Мы можем приостановить доступ при нарушении Условий.",
      ],
    },
    {
      title: "Изменения",
      paragraphs: ["Мы можем обновить Условия; продолжение использования может означать согласие, если это допускается законом."],
    },
    {
      title: "Контакт",
      paragraphs: [`Вопросы: ${op.email}.`],
    },
  ],
});

const byLocale: Record<Locale, (op: LegalOperatorDetails) => LegalDocument> = {
  en,
  be,
  ru,
};

export function getTermsWorld(
  locale: Locale,
  operator: LegalOperatorDetails,
): LegalDocument {
  return byLocale[locale](operator);
}
