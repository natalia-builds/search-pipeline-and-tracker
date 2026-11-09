// A made-up job seeker, so people can try the app before entering their own details.
import { emptyLibrary, type Library } from "./types";

const v1 = `# Jordan Rivera
jordan.rivera@example.com | 555.010.0199 | Springfield

## Summary
Product manager with **9+ years in product**, focused on tools that help small businesses get paid.

## Experience
### Brightline Payments
Senior Product Manager\t2021 - Present
* Led invoicing redesign that cut time to first payment by **31%**
* Managed 4 direct reports across product and design

### Harbor Software
Product Manager\t2016 - 2021
* Launched mobile receipts used by **120,000** businesses

## Education
State University\tB.A. Economics`;

const v2 = v1
  .replace("focused on tools that help small businesses get paid.", "focused on payments and invoicing for small businesses.")
  .replace("* Managed 4 direct reports across product and design", "* Managed 4 direct reports across product and design\n* Partnered with finance to launch instant payouts, now **18%** of volume");

export function sampleLibrary(now = new Date()): Library {
  const day = (offset: number) => new Date(now.getTime() + offset * 86400000).toISOString().slice(0, 10);
  const lib = emptyLibrary();
  lib.settings = {
    ...lib.settings,
    name: "Jordan Rivera",
    location: "Springfield",
    mustInclude: ["Brightline"],
    experienceClaims: [{ area: "product", years: 9 }],
    teamSizes: [4],
    payFloor: 150000,
  };
  lib.versions = [
    { id: "v-1", n: 1, label: "v1", note: "First version", content: v1, createdAt: day(-30) + "T12:00:00.000Z" },
    { id: "v-2", n: 2, label: "v2", note: "Led with payments results", content: v2, createdAt: day(-12) + "T12:00:00.000Z" },
  ];
  lib.currentVersion = "v-2";
  const base = { setup: "Remote", bonus: "Unknown", contact: "", url: "", notes: "", createdAt: day(-20), updatedAt: day(-2) };
  lib.applications = [
    { ...base, id: "a-1", company: "Northwind Finance", role: "Senior Product Manager", status: "Interviewing", appliedOn: day(-20), versionId: "v-1", base: "$160K - $190K", nextStep: "Panel interview", nextDate: day(3), bonus: "Mentioned" },
    { ...base, id: "a-2", company: "Tidewater Labs", role: "Group Product Manager", status: "Applied", appliedOn: day(-10), versionId: "v-2", base: "$130K - $145K", nextStep: "", nextDate: "", setup: "Requires relocation" },
    { ...base, id: "a-3", company: "Cobalt Co", role: "Product Lead", status: "Interested", appliedOn: "", versionId: "", base: "", nextStep: "Ask Sam for an intro", nextDate: day(-1) },
  ];
  lib.contacts = [
    { id: "c-1", name: "Sam Okafor", company: "Cobalt Co", title: "Director of Product", relationship: "Former colleague", reach: "sam@example.com", followUp: day(5), notes: "Offered to pass my resume along.", shares: [{ id: "s-1", versionId: "v-1", date: day(-25), note: "After coffee" }], createdAt: day(-25), updatedAt: day(-25) },
  ];
  lib.headlines = [{ id: "h-1", n: 1, label: "v1", text: "Senior Product Manager | Payments and invoicing for small businesses | 31% faster time to first payment", note: "First headline", createdAt: day(-12) + "T12:00:00.000Z" }];
  lib.currentHeadline = "h-1";
  return lib;
}
