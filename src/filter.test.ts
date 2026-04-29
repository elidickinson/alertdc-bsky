import { describe, it, expect } from "vitest";
import { classify, CATEGORIES } from "./filter";
import { buildPost } from "./bsky";
import type { Alert } from "./scrape";

function alert(title: string, body = "..."): Alert {
  return { id: "test", title, body, sendDate: Date.now() };
}

describe("classify", () => {
  it("drops Crime Alert titles", () => {
    expect(classify(alert("Crime Alert 1st District (PSA 101-108)")).kind).toBe("drop");
    expect(classify(alert("Crime Alert 7th District (PSA 701-708)")).kind).toBe("drop");
    expect(classify(alert("crime alert 5th District (PSA 501-508)")).kind).toBe("drop");
  });

  it("posts Final Update for road closures (even with police activity)", () => {
    expect(classify(alert("[AlertDC] Final Update: Road Closure / Police Activity (17th Street, NW)")))
      .toEqual({ kind: "post", category: "traffic" });
  });

  it("posts Final Update for non-crime alerts", () => {
    expect(classify(alert("[AlertDC] Final Update: 9th Street Tunnel has fully reopened")))
      .toEqual({ kind: "post", category: "traffic" });
    expect(classify(alert("[AlertDC] Final Update: Special Event street closures have lifted")))
      .toEqual({ kind: "post", category: "event" });
    expect(classify(alert("[AlertDC] Final Update: NWS Tornado Watch has expired")))
      .toEqual({ kind: "post", category: "weather" });
  });

  it("posts active police-activity road closures", () => {
    expect(classify(alert("[AlertDC] Road Closure / Police Activity (14th Street, NW)")))
      .toEqual({ kind: "post", category: "traffic" });
  });

  it("categorizes weather alerts", () => {
    expect(classify(alert("[AlertDC] NWS Tornado Watch for DC: Until 7PM Today")))
      .toEqual({ kind: "post", category: "weather" });
    expect(classify(alert("[AlertDC] Cold Alert for DC: 7PM Today to 7AM on 3/17")))
      .toEqual({ kind: "post", category: "weather" });
  });

  it("categorizes traffic alerts", () => {
    expect(classify(alert("[AlertDC] DDOT: 9th Street Tunnel will partially reopen at 5:00 p.m.")))
      .toEqual({ kind: "post", category: "traffic" });
    expect(classify(alert("[AlertDC] Lane Closures / Vehicle Crash (N/B DC-295)")))
      .toEqual({ kind: "post", category: "traffic" });
  });

  it("categorizes special events", () => {
    expect(classify(alert("[AlertDC] MPD reports on Saturday, April 25, 2026, the WHCD After Party event will take place — parking restrictions and street closures")))
      .toEqual({ kind: "post", category: "event" });
  });

  it("categorizes Secret Service alerts", () => {
    expect(classify(alert("[AlertDC] Secret Service: heightened security zone")))
      .toEqual({ kind: "post", category: "police" });
  });

  it("falls through to 'other' for unrecognized formats", () => {
    expect(classify(alert("[AlertDC] System test message")))
      .toEqual({ kind: "post", category: "other" });
  });

  it("drops empty titles", () => {
    expect(classify(alert("")).kind).toBe("drop");
    expect(classify(alert("   ")).kind).toBe("drop");
  });
});

describe("buildPost", () => {
  const URL = "https://member.everbridge.net/1332612387832012/notif/64053";

  it("adds a clickable link facet", () => {
    const out = buildPost("Tornado Watch for DC: Until 7PM today.", URL, "⛈️");
    expect(out.text).toContain("link");
    expect(out.text).not.toContain("everbridge.net");
    expect(out.facets).toBeDefined();
    expect(out.facets![0].features[0].uri).toBe(URL);
  });

  it("omits the link if body + link label would push past 300", () => {
    const out = buildPost("x".repeat(295), URL, "⛈️");
    expect(out.text).not.toContain("link");
    expect(out.facets).toBeUndefined();
  });

  it("truncates when even the body exceeds 300", () => {
    const out = buildPost("x".repeat(500), URL, "⛈️");
    expect(out.text.endsWith("…")).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(300);
  });

  it("link facet byte offsets match the \"link\" text position", () => {
    const out = buildPost("Hello", URL, "⛈️");
    expect(out.facets).toBeDefined();
    const f = out.facets![0];
    const bytes = new TextEncoder().encode(out.text);
    const slice = new TextDecoder().decode(bytes.slice(f.index.byteStart, f.index.byteEnd));
    expect(slice).toBe("link");
  });
});

describe("CATEGORIES", () => {
  it("has an emoji for every known category", () => {
    const categories = ["weather", "event", "traffic", "police", "other"];
    for (const c of categories) {
      expect(CATEGORIES[c]).toBeDefined();
    }
  });
});
