export const BUILT_IN_SERVICE_CATEGORIES = [
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
] as const;

export type BuiltInServiceCategory = (typeof BUILT_IN_SERVICE_CATEGORIES)[number];

export type ServiceType = "maintenance" | "repair" | "modification" | "parts_purchase";

export type UserServiceCategory = {
  id: string;
  user_id: string;
  name: string;
  color: string;
  created_at: string;
};

export type ServiceRecordRow = {
  id: string;
  user_id: string;
  car_id: string;
  title: string;
  category: string;
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
  category: string;
  due_date: string | null;
  due_km: number | null;
  interval_days: number | null;
  interval_km: number | null;
  auto_renew: boolean;
  last_completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export const SERVICE_CATEGORIES: string[] = [...BUILT_IN_SERVICE_CATEGORIES];

export const SERVICE_TYPES: ServiceType[] = [
  "maintenance",
  "repair",
  "modification",
  "parts_purchase",
];

export const CATEGORY_COLORS: string[] = [
  "#EF4444", "#F97316", "#EAB308", "#22C55E", "#06B6D4",
  "#3B82F6", "#8B5CF6", "#EC4899", "#14B8A6", "#F43F5E",
  "#D946EF", "#0EA5E9", "#10B981", "#F59E0B", "#6366F1",
  "#84CC16", "#C026D3", "#0891B2", "#78716C", "#E11D48",
];

export const BUILT_IN_CATEGORY_COLORS: Record<string, string> = {
  tires: "#60A5FA",
  brakes: "#F87171",
  battery_12v: "#FBBF24",
  battery_hv: "#34D399",
  coolant: "#22D3EE",
  cabin_filter: "#A78BFA",
  wipers: "#94A3B8",
  washer_fluid: "#38BDF8",
  hvac: "#FB923C",
  electrical: "#FBBF24",
  suspension: "#F472B6",
  charging_port: "#34D399",
  software: "#818CF8",
  inspection: "#2DD4BF",
  registration: "#A78BFA",
  insurance: "#FB7185",
  detailing: "#A3E635",
  parts_purchase: "#FDBA74",
  other: "#9CA3AF",
};
