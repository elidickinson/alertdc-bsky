// Minimal Bluesky/atproto client.
//
// We deliberately don't pull in @atproto/api: it's heavy, and we only need
// two endpoints: createSession + createRecord. Hitting them directly keeps
// the Workers bundle tiny and avoids surprises with the SDK's session manager
// in a stateless cron environment.

interface Session {
  did: string;
  accessJwt: string;
  handle: string;
}

const PDS = "https://bsky.social";
const LINK_LABEL = "link";

export async function login(handle: string, appPassword: string): Promise<Session> {
  const res = await fetch(`${PDS}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: handle, password: appPassword }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`bsky login failed: ${res.status} ${detail}`);
  }
  const { did, accessJwt, handle: h } = (await res.json()) as any;
  return { did, accessJwt, handle: h };
}

const BSKY_MAX_LEN = 300;

export interface BuiltPost {
  text: string;
  facets?: any[];
}

// Build the post text. Per spec: only append a link if the result fits in 300.
export function buildPost(body: string, sourceUrl: string, prefix?: string): BuiltPost {
  const tag = prefix ? `${prefix} ` : "";
  const linkSuffix = `\n\n${LINK_LABEL}`;
  const cleaned = body.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  // First try: with link.
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

  // Second try: without link.
  const noLink = `${tag}${cleaned}`;
  if (noLink.length <= BSKY_MAX_LEN) {
    return { text: noLink };
  }

  // Truncate. Reserve 1 char for ellipsis.
  const target = BSKY_MAX_LEN - 1 - tag.length;
  return { text: `${tag}${[...cleaned].slice(0, target).join("")}…` };
}

export async function createPost(session: Session, built: BuiltPost): Promise<void> {
  const record: any = {
    $type: "app.bsky.feed.post",
    text: built.text,
    createdAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    langs: ["en"],
  };
  if (built.facets) record.facets = built.facets;

  const res = await fetch(`${PDS}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`bsky createRecord failed: ${res.status} ${detail}`);
  }
}
