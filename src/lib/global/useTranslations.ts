"use client";
import { useEffect, useState } from "react";

type Messages = Record<string, unknown>;

function getNestedString(obj: Messages, path: string): string {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object") cur = (cur as Messages)[p];
    else return path;
  }
  return typeof cur === "string" ? cur : path;
}

async function loadMessages(locale: string): Promise<Messages> {
  try {
    const mod = await import(`./messages/${locale}.json`);
    return mod.default as Messages;
  } catch {
    const fallback = await import("./messages/en.json");
    return fallback.default as Messages;
  }
}

export function useTranslations(locale: string) {
  const [msgs, setMsgs] = useState<Messages>({});
  useEffect(() => { void loadMessages(locale).then(setMsgs); }, [locale]);
  return function t(key: string, vars?: Record<string, string>): string {
    let str = getNestedString(msgs, key) || key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(new RegExp(`{{\\s*${k}\\s*}}`, "g"), v);
      }
    }
    return str;
  };
}
