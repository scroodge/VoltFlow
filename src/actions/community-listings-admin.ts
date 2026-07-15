"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/supabase/knowledge";
import {
  updateCommunityListing,
  updateCommunityListingStatus,
  type CommunityListingItemType,
  type CommunityListingStatus,
} from "@/lib/supabase/community-listings";

const listingPath = "/admin/knowledge/marketplace";
const itemTypes = new Set<CommunityListingItemType>(["accessory", "spare_part", "service", "car", "other"]);
const statuses = new Set<CommunityListingStatus>(["draft", "published", "sold", "expired", "removed"]);

export async function updateCommunityListingAction(formData: FormData) {
  const guard = await requireAdmin();
  if (!guard.ok) throw new Error("Нет доступа администратора.");

  const id = requiredString(formData, "id");
  const itemType = requiredString(formData, "item_type") as CommunityListingItemType;
  if (!itemTypes.has(itemType)) throw new Error("Некорректный тип объявления.");

  const priceValue = optionalString(formData, "price");
  const price = priceValue ? Number(priceValue) : null;
  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    throw new Error("Некорректная цена.");
  }

  await updateCommunityListing(id, {
    title: requiredString(formData, "title"),
    description: requiredString(formData, "description"),
    item_type: itemType,
    city: optionalString(formData, "city"),
    generation: optionalString(formData, "generation"),
    price,
    currency: optionalString(formData, "currency"),
  });
  revalidatePath(listingPath);
}

export async function updateCommunityListingStatusAction(formData: FormData) {
  const guard = await requireAdmin();
  if (!guard.ok) throw new Error("Нет доступа администратора.");

  const status = requiredString(formData, "status") as CommunityListingStatus;
  if (!statuses.has(status)) throw new Error("Некорректный статус объявления.");
  await updateCommunityListingStatus(requiredString(formData, "id"), status);
  revalidatePath(listingPath);
}

function requiredString(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== "string" || !value.trim()) throw new Error(`Поле ${key} обязательно.`);
  return value.trim();
}

function optionalString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
