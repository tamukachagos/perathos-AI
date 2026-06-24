"use client";
import { SUPPORTED_LOCALES } from "@/lib/global/config";

interface Props {
  currentLocale: string;
}

export function LanguageSwitcher({ currentLocale }: Props) {
  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const locale = e.target.value;
    await fetch("/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale }),
    });
    window.location.reload();
  }

  return (
    <div className="lang-switcher">
      <span className="lang-globe">🌐</span>
      <select value={currentLocale} onChange={handleChange}>
        {SUPPORTED_LOCALES.map((l) => (
          <option key={l.code} value={l.code}>{l.nativeName}</option>
        ))}
      </select>
    </div>
  );
}
