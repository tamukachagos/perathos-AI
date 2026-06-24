"use client";

import { useState, useEffect, useRef } from "react";

interface LiveChatWidgetProps {
  businessName: string;
  whatsappNumber: string;
  services?: string;
}

// ── Inline translation map ────────────────────────────────────────────────────
const CHAT_T: Record<string, { greeting: string; replyTime: string; book: string; services: string; quote: string; placeholder: string; powered: string }> = {
  en: { greeting: "Hi! Welcome to {{business}}. How can we help?", replyTime: "Usually replies within minutes", book: "Book appointment", services: "Our services", quote: "Get a quote", placeholder: "Type your message...", powered: "Powered by Perathos" },
  es: { greeting: "¡Hola! Bienvenido a {{business}}. ¿En qué podemos ayudarte?", replyTime: "Normalmente responde en minutos", book: "Reservar cita", services: "Nuestros servicios", quote: "Solicitar presupuesto", placeholder: "Escribe tu mensaje...", powered: "Impulsado por Perathos" },
  pt: { greeting: "Olá! Bem-vindo à {{business}}. Como podemos ajudar?", replyTime: "Normalmente responde em minutos", book: "Agendar consulta", services: "Nossos serviços", quote: "Solicitar orçamento", placeholder: "Digite sua mensagem...", powered: "Com tecnologia Perathos" },
  fr: { greeting: "Bonjour ! Bienvenue chez {{business}}. Comment pouvons-nous vous aider ?", replyTime: "Répond généralement en quelques minutes", book: "Prendre RDV", services: "Nos services", quote: "Demander un devis", placeholder: "Tapez votre message...", powered: "Propulsé par Perathos" },
  de: { greeting: "Hallo! Willkommen bei {{business}}. Wie können wir helfen?", replyTime: "Antwortet normalerweise in Minuten", book: "Termin buchen", services: "Unsere Leistungen", quote: "Angebot anfordern", placeholder: "Nachricht eingeben...", powered: "Unterstützt von Perathos" },
  ar: { greeting: "مرحبًا! أهلًا بك في {{business}}. كيف يمكننا مساعدتك؟", replyTime: "يرد عادةً خلال دقائق", book: "حجز موعد", services: "خدماتنا", quote: "طلب عرض أسعار", placeholder: "اكتب رسالتك...", powered: "مدعوم من Perathos" },
  zh: { greeting: "您好！欢迎来到{{business}}。我们能为您做什么？", replyTime: "通常在几分钟内回复", book: "预约服务", services: "我们的服务", quote: "获取报价", placeholder: "输入消息...", powered: "由Perathos驱动" },
  ja: { greeting: "こんにちは！{{business}}へようこそ。どのようにお手伝いできますか？", replyTime: "通常数分以内に返信", book: "予約する", services: "サービス一覧", quote: "見積もりを取得", placeholder: "メッセージを入力...", powered: "Perathos提供" },
};

function buildWaUrl(phoneNumber: string, message: string): string {
  // Strip everything except digits
  const digits = phoneNumber.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function LiveChatWidget({
  businessName,
  whatsappNumber,
  services,
}: LiveChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [showBadge, setShowBadge] = useState(false);
  const [message, setMessage] = useState("");
  const [locale, setLocale] = useState("en");
  const inputRef = useRef<HTMLInputElement>(null);

  // Detect browser locale on mount
  useEffect(() => {
    const lang = navigator.language ?? "en";
    const base = lang.includes("-") ? lang.split("-")[0] : lang;
    const supported = Object.keys(CHAT_T);
    setLocale(supported.includes(base) ? base : "en");
  }, []);

  // Show the unread badge after 5 s on first load
  useEffect(() => {
    const t = setTimeout(() => setShowBadge(true), 5000);
    return () => clearTimeout(t);
  }, []);

  // Clear the badge when the panel is opened
  const handleOpen = () => {
    setOpen(true);
    setShowBadge(false);
    // Focus the input slightly after the panel renders
    setTimeout(() => inputRef.current?.focus(), 80);
  };

  const handleClose = () => setOpen(false);

  const sendMessage = (text: string) => {
    const finalText = text.trim();
    if (!finalText) return;
    const url = buildWaUrl(whatsappNumber, finalText);
    window.open(url, "_blank", "noopener,noreferrer");
    setMessage("");
  };

  const handleSend = () => sendMessage(message);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // WhatsApp SVG icon (official path)
  const WhatsAppIcon = (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );

  const SendIcon = (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  );

  const CloseIcon = (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </svg>
  );

  const c = CHAT_T[locale] ?? CHAT_T.en;
  const isRtl = locale === "ar";

  const starterMessage = c.greeting.replace("{{business}}", businessName);

  // Quick replies from translation
  const quickReplies = [c.book, c.services, c.quote];

  return (
    <>
      {/* Expanded chat panel */}
      {open && (
        <div className="chat-panel" role="dialog" aria-label={`Chat with ${businessName}`} dir={isRtl ? "rtl" : undefined}>
          {/* Header */}
          <div className="chat-panel-header">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div className="chat-panel-title">{businessName}</div>
                <div className="chat-panel-subtitle">{c.replyTime}</div>
              </div>
              <button
                onClick={handleClose}
                aria-label="Close chat"
                style={{
                  background: "rgba(255,255,255,0.2)",
                  border: "none",
                  borderRadius: "50%",
                  width: 30,
                  height: 30,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  color: "#fff",
                  flexShrink: 0,
                }}
              >
                {CloseIcon}
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="chat-panel-body" style={{ overflowY: "auto" }}>
            {/* Starter business bubble */}
            <div className="chat-bubble">{starterMessage}</div>

            {/* Quick replies */}
            <div className="chat-quick-replies">
              {quickReplies.map((reply) => (
                <button
                  key={reply}
                  className="chat-quick-reply"
                  onClick={() => sendMessage(reply)}
                >
                  {reply}
                </button>
              ))}
            </div>
          </div>

          {/* Input row */}
          <div className="chat-input-row">
            <input
              ref={inputRef}
              className="chat-input"
              type="text"
              placeholder={c.placeholder}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-label="Chat message"
            />
            <button
              className="chat-send"
              onClick={handleSend}
              aria-label="Send message on WhatsApp"
              disabled={!message.trim()}
            >
              {SendIcon}
            </button>
          </div>

          {/* Powered by */}
          <div className="chat-powered">
            <a
              href="https://perathos.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#999", textDecoration: "underline" }}
            >
              {c.powered}
            </a>
          </div>
        </div>
      )}

      {/* Floating action button */}
      {!open && (
        <button
          className="chat-fab"
          onClick={handleOpen}
          aria-label={`Chat with ${businessName} on WhatsApp`}
        >
          {/* Unread badge */}
          {showBadge && (
            <span
              style={{
                position: "absolute",
                top: -4,
                right: -4,
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: "#ff3b30",
                color: "#fff",
                fontSize: 11,
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "2px solid #fff",
              }}
              aria-label="1 unread message"
            >
              1
            </span>
          )}

          {/* "Chat with us" label pill */}
          <span className="chat-fab-label" aria-hidden="true">
            Chat with us
          </span>

          {WhatsAppIcon}
        </button>
      )}
    </>
  );
}
