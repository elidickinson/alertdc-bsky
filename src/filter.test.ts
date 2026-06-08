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

  it("handles case-insensitive crime alert variations", () => {
    expect(classify(alert("CRIME ALERT 1st District")).kind).toBe("drop");
    expect(classify(alert("Crime alert 2nd District")).kind).toBe("drop");
    expect(classify(alert("CRIME alert 3rd District")).kind).toBe("drop");
    // With punctuation
    expect(classify(alert("Crime Alert: 4th District")).kind).toBe("drop");
    expect(classify(alert("Crime Alert - 5th District")).kind).toBe("drop");
    expect(classify(alert("Crime Alert (6th District)")).kind).toBe("drop");
    // Should not match if "Crime Alert" appears later in title
    expect(classify(alert("Update: Crime Alert 7th District")).kind).toBe("post");
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

  it("adds a clickable source URL facet", () => {
    const post = buildPost("Tornado Watch for DC: Until 7PM today.", URL, "⛈️");
    const facet = post.facets[0];
    const bytes = new TextEncoder().encode(post.text);
    const linkedText = new TextDecoder().decode(bytes.slice(facet.index.byteStart, facet.index.byteEnd));

    expect(post.text).toContain(URL);
    expect(linkedText).toBe(URL);
    expect(facet.features[0]).toEqual({ $type: "app.bsky.richtext.facet#link", uri: URL });
  });

  it("includes source URL even when body is truncated", () => {
    const post = buildPost("x".repeat(295), URL, "⛈️");
    expect(post.text.endsWith(` ${URL}`)).toBe(true);
  });

  it("truncates when even the body exceeds 300", () => {
    const post = buildPost("x".repeat(500), URL, "⛈️");
    expect(post.text.endsWith(`… ${URL}`)).toBe(true);
    expect(post.text.length).toBeLessThanOrEqual(300);
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
