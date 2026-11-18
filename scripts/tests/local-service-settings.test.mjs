import assert from "node:assert/strict";
import test from "node:test";
import {
  CDO_BARANGAYS,
  formatCdoAddress,
  isCdoBarangay,
  splitCdoAddress,
} from "../../src/lib/cdo-barangays.ts";
import {
  parsePhilippineAppointment,
  startOfPhilippineDay,
} from "../../src/lib/philippine-time.ts";

test("the Cagayan de Oro picker covers all 80 barangays with distinct names", () => {
  assert.equal(CDO_BARANGAYS.length, 80);
  assert.equal(new Set(CDO_BARANGAYS).size, 80);
  assert.equal(isCdoBarangay("Carmen"), true);
  assert.equal(isCdoBarangay("Barangay 1"), true);
  assert.equal(isCdoBarangay("Barangay 10"), true);
  assert.equal(isCdoBarangay("Quezon City"), false);
});

test("service addresses round-trip without losing older address text", () => {
  const saved = formatCdoAddress("123 Sample Street", "Carmen");
  assert.equal(saved, "123 Sample Street, Carmen, Cagayan de Oro City");
  assert.deepEqual(splitCdoAddress(saved), { street: "123 Sample Street", barangay: "Carmen" });
  assert.equal(formatCdoAddress(saved, "Gusa"), "123 Sample Street, Gusa, Cagayan de Oro City");
  assert.deepEqual(splitCdoAddress("123 Sample Street"), { street: "123 Sample Street", barangay: "" });
  assert.equal(formatCdoAddress("123 Sample Street, Carmen, Cagayan de Oro City", ""), saved);
  const long = formatCdoAddress("x".repeat(400), "Barangay 10", 400);
  assert.equal(long.length, 400);
  assert.ok(long.endsWith(", Barangay 10, Cagayan de Oro City"));
});

test("an appointment and midnight are interpreted in Philippine time", () => {
  assert.equal(parsePhilippineAppointment("2026-12-04T10:05")?.toISOString(), "2026-12-04T02:05:00.000Z");
  assert.equal(parsePhilippineAppointment("2026-12-04T00:00")?.toISOString(), "2026-12-03T16:00:00.000Z");
  assert.equal(startOfPhilippineDay(new Date("2026-12-03T16:01:00Z")).toISOString(), "2026-12-03T16:00:00.000Z");
  assert.equal(parsePhilippineAppointment("2026-02-31T09:00"), null);
  assert.equal(parsePhilippineAppointment("2026-12-04T10:05Z"), null);
});
