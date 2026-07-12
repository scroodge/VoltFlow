import { Fragment, type ReactNode } from "react";

import { BynSymbol } from "@/components/brand/BynSymbol";
import { currencySymbols, formatCurrencyParts, type Currency, type Locale } from "@/lib/i18n";

/** Renders a formatted currency amount, using the new BYN graphic symbol in
 * place of the "Br" text Intl.NumberFormat falls back to (that symbol has no
 * Unicode codepoint yet — see BynSymbol). Every other currency renders
 * byte-identical to `formatCurrencyAmount`, since it's built from the same
 * `Intl.NumberFormat` parts. Only usable where a React node is valid (not
 * aria-labels, notification text, or translation-interpolated strings — those
 * still need `formatCurrencyAmount`). */
export function CurrencyAmount({
  currency,
  value,
  locale,
  minimumFractionDigits,
  maximumFractionDigits,
  className,
  symbolClassName,
}: {
  currency: Currency;
  value: number;
  locale: Locale;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  className?: string;
  symbolClassName?: string;
}) {
  const parts = formatCurrencyParts(currency, value, locale, {
    minimumFractionDigits,
    maximumFractionDigits,
  });

  return (
    <span className={className}>
      {parts.map((part, index) =>
        part.type === "currency" && currency === "BYN" ? (
          <BynSymbol
            key={index}
            className={symbolClassName ?? "inline h-[0.7em] w-[0.7em] align-[-0.05em]"}
          />
        ) : (
          <Fragment key={index}>{part.value}</Fragment>
        ),
      )}
    </span>
  );
}

/** Replaces the currency symbol substring (e.g. "Br") inside an already-
 * translated label like "Home tariff (Br/kWh)" or "BYN · Br" with the icon,
 * for spots where a real React node isn't otherwise available (translated
 * sentences, Select's plain-string `items`). No-op for non-BYN currencies or
 * if the symbol string isn't found in `text`. */
export function currencyTextWithIcon(
  text: string,
  currency: Currency,
  symbolClassName?: string,
): ReactNode {
  if (currency !== "BYN") return text;
  const symbol = currencySymbols.BYN;
  const index = text.indexOf(symbol);
  if (index === -1) return text;

  return (
    <>
      {text.slice(0, index)}
      <BynSymbol className={symbolClassName ?? "inline h-[0.85em] w-[0.85em] align-[-0.1em]"} />
      {text.slice(index + symbol.length)}
    </>
  );
}
