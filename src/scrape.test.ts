import { describe, it, expect } from "vitest";
import { fetchAlerts } from "./scrape";

// Stand up a real HTTP server and point fetchAlerts at it. This catches
// regressions in the JSON extraction logic without needing the live API.

import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

const FIXTURE = {
  count: 3,
  data: [
    {
      title: "[AlertDC] NWS Tornado Watch for DC: Until 7PM Today",
      textMessage: "[AlertDC] Tornado Watch for DC: Until 7PM today. Tornadoes are possible. Prepare to go inside nearest sturdy building, move to interior room, and stay away from windows.",
      sendDate: 1777460400411,
      expired: true,
      notificationId: "64053",
      priority: false,
    },
    {
      title: "Crime Alert 1st District (PSA 101-108)",
      textMessage: "Alert: MPD Units are investigating a Robbery snatch in the 600 block of K Street, NW. DO NOT TAKE ACTION CALL 911",
      sendDate: 1777420555552,
      expired: true,
      notificationId: "64050",
      priority: false,
    },
    {
      title: "[AlertDC] DDOT: 9th Street Tunnel partially reopening",
      textMessage: "Two southbound lanes open; right lane remains closed for lighting repairs. Use alternate routes.",
      sendDate: 1777398952617,
      expired: true,
      notificationId: "64060",
      priority: false,
    },
  ],
};

function startServer(body: object): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server: Server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
    server.listen(0, () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}/`,
        close: () => server.close(),
      });
    });
  });
}

describe("fetchAlerts", () => {
  it("parses the Everbridge JSON format", async () => {
    const { url, close } = await startServer(FIXTURE);
    try {
      const alerts = await fetchAlerts(url);
      expect(alerts).toHaveLength(3);

      expect(alerts[0].id).toBe("64053");
      expect(alerts[0].title).toBe("[AlertDC] NWS Tornado Watch for DC: Until 7PM Today");
      expect(alerts[0].body).toContain("Tornado Watch for DC");
      expect(alerts[0].sendDate).toBe(1777460400411);

      expect(alerts[1].title).toBe("Crime Alert 1st District (PSA 101-108)");
      expect(alerts[1].id).toBe("64050");

      expect(alerts[2].title).toContain("DDOT");
      expect(alerts[2].body).toContain("southbound lanes");
    } finally {
      close();
    }
  });

  it("skips items without a notificationId or title", async () => {
    const fixture = {
      count: 3,
      data: [
        { textMessage: "no id", sendDate: 1000 },
        { notificationId: "x", textMessage: "no title", sendDate: 1000 },
        { notificationId: "y", title: "valid alert", textMessage: "body", sendDate: 2000 },
      ],
    };
    const { url, close } = await startServer(fixture);
    try {
      const alerts = await fetchAlerts(url);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].title).toBe("valid alert");
    } finally {
      close();
    }
  });

  it("throws on unexpected response shape", async () => {
    const { url, close } = await startServer({ results: [] });
    try {
      await expect(fetchAlerts(url)).rejects.toThrow("unexpected response shape");
    } finally {
      close();
    }
  });

  it("handles missing textMessage gracefully", async () => {
    const fixture = {
      count: 1,
      data: [
        { notificationId: "z", title: "Title only", sendDate: 3000 },
      ],
    };
    const { url, close } = await startServer(fixture);
    try {
      const alerts = await fetchAlerts(url);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].body).toBe("");
    } finally {
      close();
    }
  });
});
