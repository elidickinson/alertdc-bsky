// Fetches AlertDC alerts from the Everbridge JSON API.
//
// The old HSEMA RSS feed (trainingtrack.hsema.dc.gov) is dead; Everbridge is
// the current backend for AlertDC. JSON is simpler and more reliable than RSS.

const ORG_ID = "1332612387832012";

export const FEED_URL =
  `https://member.everbridge.net/rest/notif/page?orgId=${ORG_ID}&pageNo=1&pageSize=25`;

export function alertUrl(id: string): string {
  return `https://member.everbridge.net/${ORG_ID}/notif/${id}`;
}

export interface Alert {
  id: string;       // notificationId — stable across polls
  title: string;
  body: string;     // textMessage
  sendDate: number; // epoch ms
}

export async function fetchAlerts(url: string = FEED_URL): Promise<Alert[]> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "alertdc-bsky-bot/1.0",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`fetch ${url} failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json() as { data?: unknown[] };

  if (!Array.isArray(json.data)) {
    throw new Error(`unexpected response shape: expected data array, got ${typeof json.data}`);
  }

  return json.data
    .filter((item: any) => item.notificationId && item.title)
    .map((item: any) => ({
      id: item.notificationId as string,
      title: (item.title as string).trim(),
      body: ((item.textMessage as string) || "").trim(),
      sendDate: item.sendDate as number,
    }));
}
