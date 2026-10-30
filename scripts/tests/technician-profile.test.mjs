/**
 * Unit tests for the published technician profile — what a customer is allowed to
 * know about the person coming to their home.
 *
 *   npm run test:technician-profile
 *
 * These run the REAL module (`src/lib/technician-profile.ts`) — Node 24 strips the
 * TypeScript types, so there is no build step and no duplicated copy of the rules
 * to drift. The card and the three data paths that feed it are read as text,
 * because a profile nobody renders is not a feature.
 *
 * WHY THIS FILE EXISTS. The assignment card used to reveal a bare name, which is
 * the moment a customer decides whether to trust the visit — and every commercial
 * service in this market shows a photo and a verification badge. Two rules are
 * easy to get wrong and are pinned here: the average comes from real `ratings` rows
 * (the cached `technicians.rating` column has no trigger maintaining it), and a
 * technician with no reviews has NO rating rather than a permanent `0.0`.
 *
 * What is NOT covered here: the rendered card, RLS, and whether the storage host
 * serves the avatar URL — all of which need a browser and the live project.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  averageRating,
  buildTechnicianProfile,
  formatRating,
  initials,
  specializationSummary,
} from "../../src/lib/technician-profile.ts";

const ROOT = new URL("../../", import.meta.url);
const LIB = "src/lib/technician-profile.ts";
const CARD = "src/components/AssignedTechnicianCard.tsx";
const STATUS_CARD = "src/components/AssignmentStatusCard.tsx";
const API = "src/app/api/service-requests/route.ts";
const REQUEST_PAGE = "src/app/customer/service-request/[id]/page.tsx";
const BOOKING_PAGE = "src/app/customer/bookings/[id]/page.tsx";

const lib = readFileSync(new URL(LIB, ROOT), "utf8");
const card = readFileSync(new URL(CARD, ROOT), "utf8");
const statusCard = readFileSync(new URL(STATUS_CARD, ROOT), "utf8");
const api = readFileSync(new URL(API, ROOT), "utf8");
const requestPage = readFileSync(new URL(REQUEST_PAGE, ROOT), "utf8");
const bookingPage = readFileSync(new URL(BOOKING_PAGE, ROOT), "utf8");

/**
 * The file with its comments stripped.
 *
 * The card's header explains why it is NOT `next/image`, why it has no `onSelect`
 * and no score — and naming those in prose made two guards fail on their first run.
 * A guard must test the code, not the paragraph about it.
 */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The published fields — the disclosure list, in full. */
const PUBLISHED_FIELDS = [
  "avatarUrl",
  "experienceYears",
  "id",
  "jobsCompleted",
  "name",
  "rating",
  "ratingCount",
  "specializations",
  "verified",
];

const USER = { id: "tech-1", name: "Juan Dela Cruz", avatar_url: null };
const RECORD = {
  approved: true,
  jobs_completed: 12,
  experience_years: 6,
  specializations: ["Refrigerator", "Air Conditioner"],
};

// ------------------------------------------------- 1. the average

test("the average comes from the ratings on record", () => {
  assert.deepEqual(averageRating([]), { average: null, count: 0 });
  assert.deepEqual(averageRating(null), { average: null, count: 0 });
  assert.deepEqual(averageRating([{ rating: 5 }]), { average: 5, count: 1 });
  assert.deepEqual(averageRating([{ rating: 5 }, { rating: 4 }, { rating: 4 }]), {
    average: 4.3,
    count: 3,
  });
  // One decimal place, so the card never prints 4.833333333333333.
  assert.equal(averageRating([{ rating: 5 }, { rating: 5 }, { rating: 4 }]).average, 4.7);
});

test("a corrupt row cannot drag the average down", () => {
  assert.deepEqual(averageRating([{ rating: Number.NaN }]), { average: null, count: 0 });
  assert.deepEqual(averageRating([{ rating: null }]), { average: null, count: 0 });
  assert.deepEqual(averageRating([{ rating: 5 }, { rating: Number.NaN }]), {
    average: 5,
    count: 1,
  });
});

test("no reviews means no rating, never a zero", () => {
  assert.equal(formatRating(null, 0), null);
  assert.equal(formatRating(0, 0), null, "a count of zero cannot produce a score");
  assert.equal(formatRating(4.8, 12), "4.8");
  assert.equal(formatRating(5, 1), "5.0", "one decimal place is always shown");
});

// ------------------------------------------------- 2. the supporting detail

test("specialisations are trimmed, de-duplicated and capped", () => {
  assert.deepEqual(specializationSummary(null), { shown: [], extra: 0 });
  assert.deepEqual(specializationSummary(["  ", ""]), { shown: [], extra: 0 });
  assert.deepEqual(specializationSummary(["Refrigerator", " Refrigerator ", "Television"]), {
    shown: ["Refrigerator", "Television"],
    extra: 0,
  });
  const many = specializationSummary(["A", "B", "C", "D", "E", "F"]);
  assert.equal(many.shown.length, 4, "four chips is what fits one row on a phone");
  assert.equal(many.extra, 2, "the rest is a count, not a wall of tags");
});

test("the avatar circle is never empty", () => {
  assert.equal(initials("Juan Dela Cruz"), "JD", "two words, two letters");
  assert.equal(initials("madonna"), "M");
  assert.equal(initials("  "), "T", "no name still needs a letter");
  assert.equal(initials(null), "T");
});

// ------------------------------------------------- 3. the published shape

test("the published shape is exactly the disclosure list", () => {
  const profile = buildTechnicianProfile({
    user: USER,
    technician: RECORD,
    ratings: [{ rating: 5 }, { rating: 4 }],
  });
  assert.ok(profile);
  // A contact column cannot be added without failing this line.
  assert.deepEqual(Object.keys(profile).sort(), PUBLISHED_FIELDS);
  assert.equal(profile.verified, true);
  assert.equal(profile.rating, 4.5);
  assert.equal(profile.ratingCount, 2);
  assert.equal(profile.jobsCompleted, 12);
  assert.equal(profile.experienceYears, 6);
  assert.deepEqual(profile.specializations, ["Refrigerator", "Air Conditioner"]);
});

test("the module never queries, so it cannot widen what is published", () => {
  assert.doesNotMatch(lib, /\.select\(/, "the module takes rows as input and reads nothing");
  assert.doesNotMatch(
    lib,
    /@supabase\/supabase-js|createClient/,
    "no client is constructed here: the caller supplies the rows"
  );
});

test("an unapproved technician is not badged as verified", () => {
  const pending = buildTechnicianProfile({
    user: USER,
    technician: { ...RECORD, approved: false },
    ratings: [],
  });
  assert.equal(pending?.verified, false);
  assert.equal(pending?.rating, null, "no reviews, no score");
});

test("a missing record degrades to less detail, not to invented zeros", () => {
  const bare = buildTechnicianProfile({ user: USER });
  assert.ok(bare);
  assert.equal(bare.verified, false);
  assert.equal(bare.rating, null);
  assert.equal(bare.jobsCompleted, null, "unknown workload is null, not 0");
  assert.equal(bare.experienceYears, null);
  assert.deepEqual(bare.specializations, []);
  assert.equal(bare.name, "Juan Dela Cruz");

  // No technician at all: there is nothing to publish.
  assert.equal(buildTechnicianProfile({ user: null }), null);
});

test("a nameless technician still has something to show", () => {
  const profile = buildTechnicianProfile({ user: { id: "tech-2", name: "   " } });
  assert.equal(profile?.name, "your technician");
  assert.equal(profile?.avatarUrl, null);
  assert.equal(initials(profile?.name), "YT");
});

// ------------------------------------------------- 4. it is actually rendered

test("the card shows the badge only when the queue itself approved the technician", () => {
  const code = withoutComments(card);
  assert.match(code, /technician\.verified &&/, "the badge must be conditional");
  assert.match(code, /formatRating\(technician\.rating, technician\.ratingCount\)/);
  assert.match(code, /initials\(technician\.name\)/, "the avatar must survive a missing photo");
  assert.match(code, /bg-cover bg-center/, "avatars are background images in this app");
  assert.doesNotMatch(
    code,
    /from "next\/image"/,
    "the storage host is not in next.config's allow-list, so next/image would refuse it"
  );
});

test("an unaccepted offer still discloses nobody", () => {
  const acceptedBranch = statusCard.slice(statusCard.indexOf("if (technician)"));
  assert.match(acceptedBranch, /<AssignedTechnicianCard/, "the card belongs to the accepted state");
  assert.match(
    statusCard,
    /if \(status === "matching" \|\| status === "offered" \|\| status === "waiting"\)/,
    "the waiting states must return before any technician is named"
  );
  assert.doesNotMatch(
    statusCard,
    /technician\.name\b/,
    "the name is rendered by the card, so there is no second place it can leak from"
  );
});

test("every surface that names a technician publishes the full profile", () => {
  for (const [name, source] of [
    [API, api],
    [REQUEST_PAGE, requestPage],
    [BOOKING_PAGE, bookingPage],
  ]) {
    assert.match(
      source,
      /buildTechnicianProfile\(/,
      `${name} must publish through the shared profile, not a bare name`
    );
    assert.match(source, /avatar_url/, `${name} must read the photo`);
    assert.match(
      source,
      /from\("technicians"\)/,
      `${name} must read the technician's record (verification, workload)`
    );
    assert.match(
      source,
      /from\("ratings"\)/,
      `${name} must read the real ratings — the cached column is not maintained`
    );
  }
});

test("the card is not the deleted ranking UI wearing a new name", () => {
  // `src/components/TechnicianCard.tsx` was deleted with the ranking model: it
  // showed a rank badge and a match score and let a customer PICK the technician it
  // ranked for them (QUEUE-SYSTEM.md, PROGRESS.md). The replacement must carry none
  // of that — it renders the one technician the rotation assigned, and nothing on it
  // is a customer decision.
  const code = withoutComments(card);
  assert.doesNotMatch(
    code,
    /onSelect=|onClick=|<button|match_score|rank=|score=/,
    "no selection, no score, no interaction: this card reports an assignment"
  );
  assert.match(card, /not the deleted ranking card/, "the relationship is documented in the file");
});

test("no surface publishes a technician's contact details", () => {
  for (const [name, source] of [
    [CARD, card],
    [STATUS_CARD, statusCard],
  ]) {
    assert.doesNotMatch(
      source,
      /technician\.(phone|email|address)/,
      `${name} must not reach for a contact column`
    );
  }
});
