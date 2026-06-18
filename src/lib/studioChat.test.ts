import { describe, expect, it } from "vitest";
import type { Business } from "./types";
import {
  chatReducer,
  emptyChat,
  guidanceReply,
  hasUsableProfile,
  mockTeamReply,
  routePrompt,
  type ChatState,
} from "./studioChat";

const baseBusiness: Business = {
  name: "",
  industry: "",
  location: "",
  whatsapp: "",
  domain: "",
  email: "",
  tone: "",
  offer: "",
  services: "",
};

describe("studioChat reducer", () => {
  it("appends an owner message on send", () => {
    const next = chatReducer(emptyChat, {
      type: "send",
      id: "a",
      text: "hello",
      at: "t0",
    });
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0]).toMatchObject({ role: "owner", text: "hello" });
  });

  it("appends a pending assistant bubble on thinking", () => {
    let s: ChatState = chatReducer(emptyChat, { type: "send", id: "a", text: "hi", at: "t0" });
    s = chatReducer(s, { type: "thinking", id: "p", at: "t1" });
    expect(s.messages).toHaveLength(2);
    expect(s.messages[1]).toMatchObject({ role: "assistant", pending: true });
  });

  it("replaces the pending placeholder on reply", () => {
    let s: ChatState = chatReducer(emptyChat, { type: "send", id: "a", text: "hi", at: "t0" });
    s = chatReducer(s, { type: "thinking", id: "p", at: "t1" });
    s = chatReducer(s, { type: "reply", replaceId: "p", id: "r", text: "done", at: "t2" });
    expect(s.messages).toHaveLength(2);
    expect(s.messages[1]).toMatchObject({ id: "r", text: "done" });
    expect(s.messages[1].pending).toBeUndefined();
  });

  it("appends a fresh reply when replaceId is missing", () => {
    let s: ChatState = chatReducer(emptyChat, { type: "send", id: "a", text: "hi", at: "t0" });
    s = chatReducer(s, { type: "reply", id: "r", text: "extra", at: "t2" });
    expect(s.messages).toHaveLength(2);
    expect(s.messages[1].text).toBe("extra");
  });

  it("does not mutate the input state", () => {
    const start = emptyChat;
    chatReducer(start, { type: "send", id: "a", text: "hi", at: "t0" });
    expect(start.messages).toHaveLength(0);
  });

  it("resets to empty", () => {
    let s: ChatState = chatReducer(emptyChat, { type: "send", id: "a", text: "hi", at: "t0" });
    s = chatReducer(s, { type: "reset" });
    expect(s.messages).toHaveLength(0);
  });
});

describe("hasUsableProfile", () => {
  it("is false for a blank profile", () => {
    expect(hasUsableProfile(baseBusiness)).toBe(false);
  });

  it("is false with a name but no descriptive fields", () => {
    expect(hasUsableProfile({ ...baseBusiness, name: "Joe" })).toBe(false);
  });

  it("is true with a name + offer", () => {
    expect(hasUsableProfile({ ...baseBusiness, name: "Joe", offer: "Plumbing" })).toBe(true);
  });

  it("is true with a name + services", () => {
    expect(hasUsableProfile({ ...baseBusiness, name: "Joe", services: "Taps, drains" })).toBe(true);
  });
});

describe("routePrompt", () => {
  it("routes to onboarding when there is no profile", () => {
    expect(routePrompt({ hasProfile: false, agentTeam: true })).toBe("onboarding");
  });

  it("routes to the agent team when entitled and a profile exists", () => {
    expect(routePrompt({ hasProfile: true, agentTeam: true })).toBe("agent-team");
  });

  it("falls back to guidance when not entitled", () => {
    expect(routePrompt({ hasProfile: true, agentTeam: false })).toBe("guidance");
  });
});

describe("guidanceReply / mockTeamReply", () => {
  it("points domain questions at the domain tool", () => {
    expect(guidanceReply("I need a web address").text.toLowerCase()).toContain("domain");
  });

  it("offers a preview card for publish questions", () => {
    const r = guidanceReply("can I go live now?");
    expect(r.card?.kind).toBe("open-preview");
  });

  it("gives a friendly default for unrelated prompts", () => {
    expect(guidanceReply("xyz").text.length).toBeGreaterThan(0);
  });

  it("mock team reply wraps guidance in a warm lead-in", () => {
    const r = mockTeamReply("add a section about specials");
    expect(r.text.toLowerCase().startsWith("your team is on it")).toBe(true);
  });
});
