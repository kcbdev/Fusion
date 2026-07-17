import { describe, expect, it } from "vitest";
import { DEFAULT_MOBILE_NAV_PRIMARY_ITEMS, resolveMobileNavPrimaryItems } from "../mobile-nav-primary-items.js";

describe("resolveMobileNavPrimaryItems", () => {
  it("uses the existing six-tab order for unset or empty values", () => {
    expect(resolveMobileNavPrimaryItems()).toMatchObject({ primaryItems: DEFAULT_MOBILE_NAV_PRIMARY_ITEMS });
    expect(resolveMobileNavPrimaryItems({ mobileNavPrimaryItems: [] })).toMatchObject({ primaryItems: DEFAULT_MOBILE_NAV_PRIMARY_ITEMS });
  });

  it("accepts planning, preserves order, and routes omitted destinations to More", () => {
    const resolved = resolveMobileNavPrimaryItems({ mobileNavPrimaryItems: ["tasks", "planning", "agents"] });
    expect(resolved.primaryItems).toEqual(["tasks", "planning", "agents"]);
    expect(resolved.omittedItems).toEqual(["command-center", "missions", "chat", "mailbox"]);
  });

  it("drops overflow-only and unknown ids, deduplicates, and clamps footer tabs", () => {
    const resolved = resolveMobileNavPrimaryItems({
      mobileNavPrimaryItems: ["settings", "tasks", "more", "documents", "tasks", "agents", "missions", "chat", "mailbox", "planning", "unknown"],
    });
    expect(resolved.primaryItems).toEqual(["tasks", "agents", "missions", "chat", "mailbox", "planning"]);
    expect(resolved.omittedItems).toEqual(["command-center"]);
  });
});
