export type ServiceCategory =
  | "tires"
  | "brakes"
  | "battery_12v"
  | "battery_hv"
  | "coolant"
  | "cabin_filter"
  | "wipers"
  | "washer_fluid"
  | "hvac"
  | "electrical"
  | "suspension"
  | "charging_port"
  | "software"
  | "inspection"
  | "registration"
  | "insurance"
  | "detailing"
  | "parts_purchase"
  | "other";

export type ServiceType = "maintenance" | "repair" | "modification" | "parts_purchase";

export type ServiceRecordRow = {
  id: string;
  user_id: string;
  car_id: string;
  title: string;
  category: ServiceCategory;
  service_type: ServiceType;
  performed_date: string;
  odometer_km: number | null;
  vendor_name: string | null;
  vendor_location: string | null;
  parts_cost: number;
  labor_cost: number;
  total_cost: number;
  currency: string;
  notes: string | null;
  receipt_url: string | null;
  photo_urls: string[];
  next_due_date: string | null;
  next_due_km: number | null;
  created_at: string;
  updated_at: string;
};

export type ServiceReminderRow = {
  id: string;
  user_id: string;
  car_id: string;
  service_record_id: string | null;
  title: string;
  category: ServiceCategory;
  due_date: string | null;
  due_km: number | null;
  interval_days: number | null;
  interval_km: number | null;
  auto_renew: boolean;
  last_completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export const SERVICE_CATEGORIES: ServiceCategory[] = [
  "tires",
  "brakes",
  "battery_12v",
  "battery_hv",
  "coolant",
  "cabin_filter",
  "wipers",
  "washer_fluid",
  "hvac",
  "electrical",
  "suspension",
  "charging_port",
  "software",
  "inspection",
  "registration",
  "insurance",
  "detailing",
  "parts_purchase",
  "other",
];

export const SERVICE_TYPES: ServiceType[] = [
  "maintenance",
  "repair",
  "modification",
  "parts_purchase",
];
