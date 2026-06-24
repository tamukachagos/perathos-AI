// Generates the language instruction to append to LLM prompts for non-English locales.

const LANG_NAMES: Record<string, string> = {
  "es":    "Spanish",
  "pt":    "Portuguese",
  "pt-BR": "Brazilian Portuguese",
  "fr":    "French",
  "de":    "German",
  "it":    "Italian",
  "nl":    "Dutch",
  "ar":    "Arabic",
  "zh":    "Chinese (Simplified)",
  "ja":    "Japanese",
  "ko":    "Korean",
  "hi":    "Hindi",
  "ru":    "Russian",
  "tr":    "Turkish",
  "sw":    "Swahili",
  "af":    "Afrikaans",
};

export function localeInstruction(locale: string, countryCode: string): string {
  if (locale === "en") return "";
  const lang = LANG_NAMES[locale] ?? locale;
  return `\n\nIMPORTANT: Write this content entirely in ${lang}. Use cultural references, idioms, and examples appropriate for audiences in ${countryCode}. Do NOT include English text unless it is a brand name.`;
}

export function localeSeoInstruction(locale: string, countryCode: string): string {
  if (locale === "en") return "";
  const lang = LANG_NAMES[locale] ?? locale;
  return `\n\nGenerate keywords in ${lang} language as used by searchers in ${countryCode}. Include both ${lang} terms and common English hybrid searches if relevant to that market.`;
}

const PRIMARY_SEARCH_ENGINES: Record<string, string> = {
  CN: "Baidu", RU: "Yandex", KR: "Naver", JP: "Google/Yahoo! Japan",
};

export function getSearchEngine(countryCode: string): string {
  return PRIMARY_SEARCH_ENGINES[countryCode] ?? "Google";
}

const GDPR_COUNTRIES = new Set(["DE","FR","IT","ES","NL","BE","AT","SE","DK","FI","PL","CZ","HU","RO","BG","HR","SI","SK","LT","LV","EE","IE","LU","MT","CY","GR","PT"]);

export function getEmailComplianceFooter(countryCode: string, businessName: string, unsubLink: string): string {
  if (GDPR_COUNTRIES.has(countryCode) || countryCode === "GB") {
    return `<p style="font-size:11px;color:#999">Sent by ${businessName}. <a href="${unsubLink}">Unsubscribe</a> | GDPR compliant.</p>`;
  }
  if (countryCode === "CA") {
    return `<p style="font-size:11px;color:#999">You consented to receive emails from ${businessName}. <a href="${unsubLink}">Unsubscribe</a> | CASL compliant.</p>`;
  }
  if (countryCode === "AU") {
    return `<p style="font-size:11px;color:#999">Sent by ${businessName}. <a href="${unsubLink}">Unsubscribe</a> | Australian Spam Act compliant.</p>`;
  }
  if (countryCode === "BR") {
    return `<p style="font-size:11px;color:#999">Enviado por ${businessName}. <a href="${unsubLink}">Cancelar inscrição</a> | Em conformidade com a LGPD.</p>`;
  }
  return `<p style="font-size:11px;color:#999">From ${businessName}. <a href="${unsubLink}">Unsubscribe</a></p>`;
}
