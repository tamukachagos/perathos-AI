"use server";

// SMS adapter — outbound SMS via Africa's Talking.
// Gated on AFRICAS_TALKING_API_KEY + AFRICAS_TALKING_USERNAME.
// Falls back to mock (console logging) when either env var is absent.

const AT_MESSAGING_URL = "https://api.africastalking.com/version1/messaging";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SmsRecipientResult {
  number: string;
  status: string;
  messageId?: string;
  cost?: string;
}

export interface SmsSendResult {
  recipients: SmsRecipientResult[];
  messageCount: number;
}

export interface SmsProvider {
  sendSms(to: string, message: string, from?: string): Promise<SmsSendResult>;
  sendBulk(recipients: string[], message: string): Promise<SmsSendResult>;
}

// ---------------------------------------------------------------------------
// Internal helper — build Africa's Talking form body
// ---------------------------------------------------------------------------

function buildAtBody(
  username: string,
  to: string[],
  message: string,
  from?: string,
): URLSearchParams {
  const params = new URLSearchParams({
    username,
    to: to.join(","),
    message,
  });
  if (from) params.set("from", from);
  return params;
}

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

export function createMockAdapter(): SmsProvider {
  return {
    async sendSms(to, message, from) {
      console.log(`[mock:sms] sendSms to=${to} from=${from ?? "default"}: ${message}`);
      return {
        recipients: [{ number: to, status: "Success", messageId: `mock-msg-${Date.now()}` }],
        messageCount: 1,
      };
    },

    async sendBulk(recipients, message) {
      console.log(
        `[mock:sms] sendBulk to ${recipients.length} numbers: ${message.slice(0, 80)}`,
      );
      return {
        recipients: recipients.map((number, i) => ({
          number,
          status: "Success",
          messageId: `mock-msg-${Date.now()}-${i}`,
        })),
        messageCount: recipients.length,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Real adapter — Africa's Talking REST API
// ---------------------------------------------------------------------------

interface AtResponse {
  SMSMessageData?: {
    Recipients?: Array<{
      number: string;
      status: string;
      messageId?: string;
      cost?: string;
    }>;
    Message?: string;
  };
}

export function createRealAdapter(): SmsProvider {
  const apiKey = process.env.AFRICAS_TALKING_API_KEY!;
  const username = process.env.AFRICAS_TALKING_USERNAME!;

  async function callAt(to: string[], message: string, from?: string): Promise<SmsSendResult> {
    const res = await fetch(AT_MESSAGING_URL, {
      method: "POST",
      headers: {
        apiKey,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: buildAtBody(username, to, message, from),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Africa's Talking SMS error ${res.status}: ${text}`);
    }

    const json = (await res.json()) as AtResponse;
    const raw = json.SMSMessageData?.Recipients ?? [];

    return {
      recipients: raw.map((r) => ({
        number: r.number,
        status: r.status,
        messageId: r.messageId,
        cost: r.cost,
      })),
      messageCount: raw.length,
    };
  }

  return {
    async sendSms(to, message, from) {
      return callAt([to], message, from);
    },

    async sendBulk(recipients, message) {
      return callAt(recipients, message);
    },
  };
}

// ---------------------------------------------------------------------------
// Readiness + public surface
// ---------------------------------------------------------------------------

export function isConfigured(): boolean {
  return !!(process.env.AFRICAS_TALKING_API_KEY && process.env.AFRICAS_TALKING_USERNAME);
}

export function getProvider(): SmsProvider {
  if (isConfigured()) {
    return createRealAdapter();
  }
  return createMockAdapter();
}
