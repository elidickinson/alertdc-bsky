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
  if (withLink.length <= BSKY_MAX_LEN) {
    const linkStart = new TextEncoder().encode(withLink.slice(0, withLink.lastIndexOf(LINK_LABEL))).length;
    const linkEnd = linkStart + new TextEncoder().encode(LINK_LABEL).length;
    return {
      text: withLink,
      facets: [{
        index: { byteStart: linkStart, byteEnd: linkEnd },
        features: [{ $type: "app.bsky.richtext.facet#link", uri: sourceUrl }],
      }],
    };
  }

  const noLink = `${tag}${cleaned}`;
  if (noLink.length <= BSKY_MAX_LEN) {
    return { text: noLink };
  }

  const GRAPHEME_BUFFER = 10;
  const target = BSKY_MAX_LEN - 1 - tag.length - GRAPHEME_BUFFER;
  return { text: `${tag}${[...cleaned].slice(0, target).join("")}…` };
}
