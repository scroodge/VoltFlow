import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

const SERVICE_CATEGORIES = [
  "tires", "brakes", "battery_12v", "battery_hv", "coolant",
  "cabin_filter", "wipers", "washer_fluid", "hvac", "electrical",
  "suspension", "charging_port", "software", "inspection",
  "registration", "insurance", "detailing", "parts_purchase", "other",
];

const SERVICE_TYPES = ["maintenance", "repair", "modification", "parts_purchase"];

const serviceRecordSchema = z.object({
  carId: z.string().uuid(),
  title: z.string().min(1).max(300),
  category: z.string().refine((v) => SERVICE_CATEGORIES.includes(v), { message: "Invalid category" }),
  serviceType: z.string().refine((v) => SERVICE_TYPES.includes(v), { message: "Invalid service type" }),
  performedDate: z.string(),
  odometerKm: z.coerce.number().min(0).max(9_999_999).nullable().optional(),
  vendorName: z.string().max(200).nullable().optional(),
  vendorLocation: z.string().max(300).nullable().optional(),
  partsCost: z.coerce.number().min(0).max(9_999_999).default(0),
  laborCost: z.coerce.number().min(0).max(9_999_999).default(0),
  totalCost: z.coerce.number().min(0).max(9_999_999).default(0),
  currency: z.string().max(10).default("EUR"),
  notes: z.string().max(5000).nullable().optional(),
  nextDueDate: z.string().nullable().optional(),
  nextDueKm: z.coerce.number().min(0).max(9_999_999).nullable().optional(),
});

describe("serviceRecordSchema", () => {
  const valid = {
    carId: "550e8400-e29b-41d4-a716-446655440000",
    title: "Cabin filter replacement",
    category: "cabin_filter",
    serviceType: "maintenance",
    performedDate: "2026-06-15",
    partsCost: 18,
    laborCost: 0,
    totalCost: 18,
    currency: "EUR",
  };

  it("accepts a valid minimal record", () => {
    const result = serviceRecordSchema.safeParse(valid);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.title, "Cabin filter replacement");
      assert.equal(result.data.partsCost, 18);
      assert.equal(result.data.totalCost, 18);
    }
  });

  it("accepts a record with all optional fields", () => {
    const result = serviceRecordSchema.safeParse({
      ...valid,
      odometerKm: 32450,
      vendorName: "Auto Shop",
      vendorLocation: "Minsk",
      notes: "Replaced cabin filter, all good.",
      nextDueDate: "2027-06-15",
      nextDueKm: 50000,
    });
    assert.equal(result.success, true);
  });

  it("rejects empty title", () => {
    const result = serviceRecordSchema.safeParse({ ...valid, title: "" });
    assert.equal(result.success, false);
  });

  it("rejects invalid category", () => {
    const result = serviceRecordSchema.safeParse({ ...valid, category: "oil_change" });
    assert.equal(result.success, false);
  });

  it("rejects invalid serviceType", () => {
    const result = serviceRecordSchema.safeParse({ ...valid, serviceType: "recall" });
    assert.equal(result.success, false);
  });

  it("rejects negative cost", () => {
    const result = serviceRecordSchema.safeParse({ ...valid, partsCost: -10 });
    assert.equal(result.success, false);
  });

  it("defaults cost to 0 when omitted", () => {
    const { partsCost, laborCost, totalCost, ...withoutCost } = valid;
    const result = serviceRecordSchema.safeParse(withoutCost);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.partsCost, 0);
      assert.equal(result.data.laborCost, 0);
      assert.equal(result.data.totalCost, 0);
    }
  });

  it("accepts odometer as string (coercion)", () => {
    const result = serviceRecordSchema.safeParse({
      ...valid,
      odometerKm: "32450",
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.odometerKm, 32450);
    }
  });

  it("rejects too-long title", () => {
    const result = serviceRecordSchema.safeParse({
      ...valid,
      title: "x".repeat(301),
    });
    assert.equal(result.success, false);
  });
});
