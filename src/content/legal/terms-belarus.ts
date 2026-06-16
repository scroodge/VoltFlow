import type { Locale } from "@/lib/i18n";
import type { LegalDocument, LegalOperatorDetails } from "@/content/legal/types";

const UPDATED = "2026-06-16";

const en = (op: LegalOperatorDetails): LegalDocument => ({
  title: "Terms of Service (Belarus)",
  updatedAt: UPDATED,
  sections: [
    {
      title: "Parties and scope",
      paragraphs: [
        `${op.name}, ${op.address} (“Operator”), provides VoltFlow to users in the Republic of Belarus. These Terms form a user agreement under the laws of the Republic of Belarus unless mandatory consumer rules provide otherwise.`,
        `Contact: ${op.email}.`,
      ],
    },
    {
      title: "Service description",
      paragraphs: [
        "VoltFlow helps plan and record EV charging sessions, costs, and vehicle telemetry history. It is not a charger controller and does not replace manufacturer systems or on-site safety checks.",
      ],
    },
    {
      title: "Account and data",
      bullets: [
        "You agree to provide truthful registration data.",
        "Processing of personal data is described in the Belarus Privacy Policy.",
        "API keys and pairing codes must be kept confidential.",
      ],
    },
    {
      title: "User obligations",
      bullets: [
        "Use the Service lawfully and respect third-party rights.",
        "Do not interfere with other users or infrastructure.",
        "Ensure Mate permissions on the vehicle tablet comply with your responsibilities as driver/owner.",
      ],
    },
    {
      title: "Consumer information",
      paragraphs: [
        "Where you qualify as a consumer under Belarus law, non-waivable rights remain unaffected. Estimates and analytics are informational; verify billing with your energy supplier.",
      ],
    },
    {
      title: "Intellectual property",
      paragraphs: [
        "VoltFlow software, branding, and content are protected. Open-source components remain under their respective licenses.",
      ],
    },
    {
      title: "Liability",
      paragraphs: [
        "The Service is provided without warranty beyond what is mandatory under Belarus law. Operator liability for damages is limited to the extent permitted by applicable legislation.",
      ],
    },
    {
      title: "Suspension and termination",
      paragraphs: [
        "You may cease use and request account deletion. Operator may restrict access for violations or security reasons with notice where practicable.",
      ],
    },
    {
      title: "Governing law and disputes",
      paragraphs: [
        "These Terms are governed by the laws of the Republic of Belarus. Disputes should first be addressed to the contact email; courts of the Republic of Belarus have jurisdiction unless mandatory rules specify otherwise.",
      ],
    },
    {
      title: "Changes",
      paragraphs: [
        `Updated versions take effect upon publication with a revised date. Material changes may be communicated through the app where appropriate.`,
      ],
    },
  ],
});

const be = (op: LegalOperatorDetails): LegalDocument => ({
  title: "Умовы карыстання (Беларусь)",
  updatedAt: UPDATED,
  sections: [
    {
      title: "Бакі і сфера",
      paragraphs: [
        `${op.name}, ${op.address} («Аператар»), прадастаўляе VoltFlow карыстальнікам у Рэспубліцы Беларусь. Гэтыя Умовы з’яўляюцца карыстальніцкім пагадненнем па заканадаўстве Рэспублікі Беларусь, калі імператыўныя нормы не прадугледжваюць іншае.`,
        `Кантакт: ${op.email}.`,
      ],
    },
    {
      title: "Апісанне сэрвісу",
      paragraphs: [
        "VoltFlow дапамагае планаваць і ўлічваць сесіі зарадкі, кошты і гісторыю тэлеметрыі. Гэта не кантролер зарадкі і не замяняе сістэмы вытворцы і праверкі бяспекі на месцы.",
      ],
    },
    {
      title: "Акаўнт і даныя",
      bullets: [
        "Вы пагаджаецеся падаваць дакладныя рэгістрацыйныя даныя.",
        "Апрацоўка персанальных даных апісана ў беларускай Палітыцы прыватнасці.",
        "API-ключы і коды злучэння павінны захоўвацца канфідэнцыйна.",
      ],
    },
    {
      title: "Абавязкі карыстальніка",
      bullets: [
        "Выкарыстоўваць Сэрвіс законна і паважаць правы трэціх асоб.",
        "Не парушаць работу іншых карыстальнікаў і інфраструктуры.",
        "Забяспечыць дазволы Mate на планшэце аўто ў адпаведнасці з вашай адказнасцю.",
      ],
    },
    {
      title: "Інфармацыя для спажыўца",
      paragraphs: [
        "Калі вы з’яўляецеся спажыўцам па законе РБ, неадменныя правы захоўваюцца. Ацэнкі і аналітыка маюць інфармацыйны характар; лічэнні за энергію правярайце ў пастаўшчыка.",
      ],
    },
    {
      title: "Інтэлектуальная ўласнасць",
      paragraphs: [
        "Праграмнае забеспячэнне, брэнд і змесціва VoltFlow абаронены. Кампаненты з адкрытым кодам застаюцца пад сваімі ліцэнзіямі.",
      ],
    },
    {
      title: "Адказнасць",
      paragraphs: [
        "Сэрвіс прадастаўляецца без гарантый па-за межамі імператыўных норм закона РБ. Адказнасць Аператара абмежавана ў межах, дазволеных заканадаўствам.",
      ],
    },
    {
      title: "Прыпыненне",
      paragraphs: [
        "Вы можаце спыніць выкарыстанне і запытаць выдаленне акаўнта. Аператар можа абмежаваць доступ пры парушэннях або з меркаванняў бяспекі з апавяшчэннем, калі гэта магчыма.",
      ],
    },
    {
      title: "Прымяняльнае права і споры",
      paragraphs: [
        "Умовы рэгулююцца заканадаўствам Рэспублікі Беларусь. Споры спачатку накіравайце на email кантакту; юрысдыкцыя судоў РБ, калі імператыўныя нормы не прадугледжваюць іншае.",
      ],
    },
    {
      title: "Змены",
      paragraphs: [
        "Абноўленыя версіі набываюць сілу з моманту публікацыі з новай датай.",
      ],
    },
  ],
});

const ru = (op: LegalOperatorDetails): LegalDocument => ({
  title: "Условия использования (Беларусь)",
  updatedAt: UPDATED,
  sections: [
    {
      title: "Стороны и сфера",
      paragraphs: [
        `${op.name}, ${op.address} («Оператор»), предоставляет VoltFlow пользователям в Республике Беларусь. Настоящие Условия являются пользовательским соглашением по законодательству Республики Беларусь, если императивные нормы не предусматривают иное.`,
        `Контакт: ${op.email}.`,
      ],
    },
    {
      title: "Описание сервиса",
      paragraphs: [
        "VoltFlow помогает планировать и учитывать сессии зарядки, стоимость и историю телеметрии. Это не контроллер зарядки и не заменяет системы производителя и проверки безопасности на месте.",
      ],
    },
    {
      title: "Аккаунт и данные",
      bullets: [
        "Вы соглашаетесь предоставлять точные регистрационные данные.",
        "Обработка персональных данных описана в белорусской Политике конфиденциальности.",
        "API-ключи и коды подключения должны храниться конфиденциально.",
      ],
    },
    {
      title: "Обязанности пользователя",
      bullets: [
        "Использовать Сервис законно и уважать права третьих лиц.",
        "Не нарушать работу других пользователей и инфраструктуры.",
        "Обеспечить разрешения Mate на планшете авто в соответствии с вашей ответственностью.",
      ],
    },
    {
      title: "Информация для потребителя",
      paragraphs: [
        "Если вы являетесь потребителем по закону РБ, неотменяемые права сохраняются. Оценки и аналитика носят информационный характер; счета за энергию проверяйте у поставщика.",
      ],
    },
    {
      title: "Интеллектуальная собственность",
      paragraphs: [
        "Программное обеспечение, бренд и содержимое VoltFlow защищены. Компоненты с открытым кодом остаются под своими лицензиями.",
      ],
    },
    {
      title: "Ответственность",
      paragraphs: [
        "Сервис предоставляется без гарантий за пределами императивных норм закона РБ. Ответственность Оператора ограничена в пределах, допускаемых законодательством.",
      ],
    },
    {
      title: "Приостановление",
      paragraphs: [
        "Вы можете прекратить использование и запросить удаление аккаунта. Оператор может ограничить доступ при нарушениях или по соображениям безопасности с уведомлением, когда это возможно.",
      ],
    },
    {
      title: "Применимое право и споры",
      paragraphs: [
        "Условия регулируются законодательством Республики Беларусь. Споры сначала направляйте на email контакта; юрисдикция судов РБ, если императивные нормы не предусматривают иное.",
      ],
    },
    {
      title: "Изменения",
      paragraphs: [
        "Обновлённые версии вступают в силу с момента публикации с новой датой.",
      ],
    },
  ],
});

const byLocale: Record<Locale, (op: LegalOperatorDetails) => LegalDocument> = {
  en,
  be,
  ru,
};

export function getTermsBelarus(
  locale: Locale,
  operator: LegalOperatorDetails,
): LegalDocument {
  return byLocale[locale](operator);
}
