"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { SERVICE_TYPES } from "@/types/service";

const serviceRecordSchema = z.object({
  carId: z.string().uuid(),
  title: z.string().min(1).max(300),
  category: z.string().min(1).max(80),
  serviceType: z.enum(SERVICE_TYPES as [string, ...string[]]),
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

export async function insertServiceRecord(input: z.infer<typeof serviceRecordSchema>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false as const, error: "Unauthorized" };

  const parsed = serviceRecordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: "Invalid input" };
  }

  const {
    carId,
    title,
    category,
    serviceType,
    performedDate,
    odometerKm,
    vendorName,
    vendorLocation,
    partsCost,
    laborCost,
    totalCost,
    currency,
    notes,
    nextDueDate,
    nextDueKm,
  } = parsed.data;

  const finalTotal = totalCost > 0 ? totalCost : partsCost + laborCost;

  const { data: record, error: insertError } = await supabase
    .from("vehicle_service_records")
    .insert({
      user_id: user.id,
      car_id: carId,
      title,
      category,
      service_type: serviceType,
      performed_date: performedDate,
      odometer_km: odometerKm ?? null,
      vendor_name: vendorName ?? null,
      vendor_location: vendorLocation ?? null,
      parts_cost: partsCost,
      labor_cost: laborCost,
      total_cost: finalTotal,
      currency,
      notes: notes ?? null,
      next_due_date: nextDueDate ?? null,
      next_due_km: nextDueKm ?? null,
    })
    .select("id")
    .single();

  if (insertError) {
    return { ok: false as const, error: insertError.message };
  }

  if (nextDueDate || nextDueKm) {
    await supabase.from("vehicle_service_reminders").insert({
      user_id: user.id,
      car_id: carId,
      service_record_id: record.id,
      title,
      category,
      due_date: nextDueDate ?? null,
      due_km: nextDueKm ?? null,
    });
  }

  revalidatePath("/service");
  return { ok: true as const, id: record.id };
}

const updateSchema = serviceRecordSchema.partial().extend({
  id: z.string().uuid(),
});

export async function updateServiceRecord(input: z.infer<typeof updateSchema>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false as const, error: "Unauthorized" };

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: "Invalid input" };
  }

  const { id: recordId, carId, partsCost, laborCost, totalCost, ...rest } = parsed.data;

  const updateData: Record<string, unknown> = {};
  if (carId) updateData.car_id = carId;
  if (rest.title !== undefined) updateData.title = rest.title;
  if (rest.category !== undefined) updateData.category = rest.category;
  if (rest.serviceType !== undefined) updateData.service_type = rest.serviceType;
  if (rest.performedDate !== undefined) updateData.performed_date = rest.performedDate;
  if (rest.odometerKm !== undefined) updateData.odometer_km = rest.odometerKm;
  if (rest.vendorName !== undefined) updateData.vendor_name = rest.vendorName;
  if (rest.vendorLocation !== undefined) updateData.vendor_location = rest.vendorLocation;
  if (partsCost !== undefined) updateData.parts_cost = partsCost;
  if (laborCost !== undefined) updateData.labor_cost = laborCost;
  if (totalCost !== undefined) updateData.total_cost = totalCost;
  else if (partsCost !== undefined || laborCost !== undefined) {
    const record = await supabase
      .from("vehicle_service_records")
      .select("parts_cost, labor_cost")
      .eq("id", recordId)
      .eq("user_id", user.id)
      .single();
    if (!record.error && record.data) {
      updateData.total_cost = (partsCost ?? record.data.parts_cost) + (laborCost ?? record.data.labor_cost);
    }
  }
  if (rest.currency !== undefined) updateData.currency = rest.currency;
  if (rest.notes !== undefined) updateData.notes = rest.notes;
  if (rest.nextDueDate !== undefined) updateData.next_due_date = rest.nextDueDate;
  if (rest.nextDueKm !== undefined) updateData.next_due_km = rest.nextDueKm;

  const { error } = await supabase
    .from("vehicle_service_records")
    .update(updateData)
    .eq("id", recordId)
    .eq("user_id", user.id);

  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/service");
  return { ok: true as const };
}

export async function deleteServiceRecord(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false as const, error: "Unauthorized" };

  await supabase
    .from("vehicle_service_reminders")
    .delete()
    .eq("service_record_id", id)
    .eq("user_id", user.id);

  const { error } = await supabase
    .from("vehicle_service_records")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/service");
  return { ok: true as const };
}

export async function uploadServiceAttachment(
  recordId: string,
  formData: FormData,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false as const, error: "Unauthorized" };

  const file = formData.get("file") as File | null;
  if (!file) return { ok: false as const, error: "No file provided" };

  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `${user.id}/${recordId}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("service-attachments")
    .upload(path, file);

  if (uploadError) return { ok: false as const, error: uploadError.message };

  const { data: urlData } = supabase.storage
    .from("service-attachments")
    .getPublicUrl(path);

  const { error: updateError } = await supabase
    .from("vehicle_service_records")
    .update({ receipt_url: urlData.publicUrl })
    .eq("id", recordId)
    .eq("user_id", user.id);

  if (updateError) return { ok: false as const, error: updateError.message };

  return { ok: true as const, url: urlData.publicUrl };
}
