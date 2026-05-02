import { AtpAgent } from "@atproto/api";
import type { AtpSessionData } from "@atproto/api";

export type { AtpSessionData };

const PDS = "https://bsky.social";
const BSKY_MAX_LEN = 300;
const LINK_LABEL = "link";

export type SessionPersist = (session: AtpSessionData) => void;

export function createAgent(onSessionUpdate: SessionPersist): AtpAgent {
  return new AtpAgent({
    service: PDS,
    persistSession: (_evt, session) => {
      if (session) onSessionUpdate(session);
    },
  });
}

export async function resumeOrLogin(
  agent: AtpAgent,
  storedSession: AtpSessionData | null,
  handle: string,
  appPassword: string,
  log?: (msg: string) => void,
): Promise<void> {
  if (storedSession) {
    try {
      await agent.resumeSession(storedSession);
      return;
    } catch (err) {
      log?.(`session resume failed: ${(err as Error).message}; re-logging in`);
    }
  }
  await agent.login({ identifier: handle, password: appPassword });
}

export interface BuiltPost {
  text: string;
  facets?: any[];
}

export function buildPost(body: string, sourceUrl: string, prefix?: string): BuiltPost {
  const tag = prefix ? `${prefix} ` : "";
  const linkSuffix = ` ${LINK_LABEL}`;
  const cleaned = body.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  const withLink = `${tag}${cleaned}${linkSuffix}`;
  const text = withLink.length <= BSKY_MAX_LEN
    ? withLink
    : `${tag}${[...cleaned].slice(0, BSKY_MAX_LEN - tag.length - 1 - linkSuffix.length).join("")}…${linkSuffix}`;

  // Facets use byte offsets, not string indices — text always ends with LINK_LABEL.
  const encoder = new TextEncoder();
  const byteEnd = encoder.encode(text).byteLength;
  const byteStart = byteEnd - encoder.encode(LINK_LABEL).byteLength;
  return {
    text,
    facets: [{
      index: { byteStart, byteEnd },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: sourceUrl }],
    }],
  };
}
