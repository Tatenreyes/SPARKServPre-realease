// Philippine Statistics Authority PSGC: https://psa.gov.ph/classification/psgc/barangays/1030500000
export const CDO_BARANGAYS = [
  "Agusan",
  "Baikingon",
  "Balubal",
  "Balulang",
  "Barangay 1",
  "Barangay 2",
  "Barangay 3",
  "Barangay 4",
  "Barangay 5",
  "Barangay 6",
  "Barangay 7",
  "Barangay 8",
  "Barangay 9",
  "Barangay 10",
  "Barangay 11",
  "Barangay 12",
  "Barangay 13",
  "Barangay 14",
  "Barangay 15",
  "Barangay 16",
  "Barangay 17",
  "Barangay 18",
  "Barangay 19",
  "Barangay 20",
  "Barangay 21",
  "Barangay 22",
  "Barangay 23",
  "Barangay 24",
  "Barangay 25",
  "Barangay 26",
  "Barangay 27",
  "Barangay 28",
  "Barangay 29",
  "Barangay 30",
  "Barangay 31",
  "Barangay 32",
  "Barangay 33",
  "Barangay 34",
  "Barangay 35",
  "Barangay 36",
  "Barangay 37",
  "Barangay 38",
  "Barangay 39",
  "Barangay 40",
  "Bayabas",
  "Bayanga",
  "Besigan",
  "Bonbon",
  "Bugo",
  "Bulua",
  "Camaman-an",
  "Canito-an",
  "Carmen",
  "Consolacion",
  "Cugman",
  "Dansolihon",
  "F. S. Catanico",
  "Gusa",
  "Indahag",
  "Iponan",
  "Kauswagan",
  "Lapasan",
  "Lumbia",
  "Macabalan",
  "Macasandig",
  "Mambuaya",
  "Nazareth",
  "Pagalungan",
  "Pagatpat",
  "Patag",
  "Pigsag-an",
  "Puerto",
  "Puntod",
  "San Simon",
  "Tablon",
  "Taglimao",
  "Tagpangi",
  "Tignapoloan",
  "Tuburan",
  "Tumpagon",
] as const;

export const CDO_CITY = "Cagayan de Oro City";

export function isCdoBarangay(value: unknown): value is typeof CDO_BARANGAYS[number] {
  return typeof value === "string" && CDO_BARANGAYS.some((name) => name === value);
}

/** Keep older address strings usable when the barangay cannot be read reliably. */
export function splitCdoAddress(address: string): { street: string; barangay: string } {
  const parts = address.split(",").map((part) => part.trim());
  const last = parts.pop();
  if (!last || !/^cagayan de oro(?: city)?$/i.test(last)) return { street: address, barangay: "" };
  const savedBarangay = parts.pop()?.toLowerCase();
  const barangay = CDO_BARANGAYS.find((name) => name.toLowerCase() === savedBarangay);
  if (!barangay || !parts.join("").trim()) return { street: address, barangay: "" };
  return { street: parts.join(", "), barangay };
}

export function formatCdoAddress(street: string, barangay: string, maxLength?: number): string {
  const suffix = isCdoBarangay(barangay) ? ", " + barangay + ", " + CDO_CITY : "";
  const streetLimit = maxLength === undefined ? undefined : Math.max(0, maxLength - suffix.length);
  const address = suffix ? splitCdoAddress(street).street : street;
  const line = address.trim().slice(0, streetLimit).trimEnd();
  return line ? line + suffix : "";
}
