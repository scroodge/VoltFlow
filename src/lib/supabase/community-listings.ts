import { createClient } from "@/lib/supabase/server";

export const communityListingStatuses = ["draft", "published", "sold", "expired", "removed"] as const;
export type CommunityListingStatus = (typeof communityListingStatuses)[number];
export type CommunityListingType = "sell" | "wanted" | "service";
export type CommunityListingItemType = "accessory" | "spare_part" | "service" | "car" | "other";

export type CommunityListing = {
  id: string;
  telegram_user_id: number | null;
  listing_type: CommunityListingType;
  title: string;
  description: string;
  item_type: CommunityListingItemType;
  city: string | null;
  generation: string | null;
  price: number | null;
  currency: string | null;
  contact_link: string | null;
  source_chat_id: number;
  source_message_id: number;
  status: CommunityListingStatus;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export async function getAdminCommunityListings() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("community_listings")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) throw new Error(`Failed to load community listings: ${error.message}`);
  return (data ?? []) as CommunityListing[];
}

export async function updateCommunityListing(
  id: string,
  input: Pick<CommunityListing, "title" | "description" | "item_type" | "city" | "generation" | "price" | "currency">,
) {
  const supabase = await createClient();
  const { error } = await supabase.from("community_listings").update(input).eq("id", id);
  if (error) throw new Error(`Failed to update community listing: ${error.message}`);
}

export async function updateCommunityListingStatus(id: string, status: CommunityListingStatus) {
  const supabase = await createClient();
  const { error } = await supabase.from("community_listings").update({ status }).eq("id", id);
  if (error) throw new Error(`Failed to update community listing status: ${error.message}`);
}

export async function deleteCommunityListing(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("community_listings").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete community listing: ${error.message}`);
}
