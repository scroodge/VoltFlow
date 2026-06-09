export const DIPLUS_DENY_PATTERNS = [
  "发送CAN",
  "执行SHELL",
  "执行TSHELL",
  "点击",
  "滑动",
  "按钮",
  "按键",
  "浮窗",
  "下电",
] as const;

export const VEHICLE_COMMAND_TYPES = [
  "lock",
  "unlock",
  "set_soc_limit",
  "schedule_charge",
  "window",
  "windows_preset",
  "ac",
  "ac_vent",
  "sunroof",
  "sunshade",
  "hud",
  "auto_highbeam",
  "child_lock_left",
  // Extended set — keep in sync with CommandAllowlist.kt + BYD_MA COMMAND_ALLOWLIST.md.
  "sentry",
  "sentry_autostart",
  "screen_off",
  "windows_close",
  "ac_temp_up",
  "ac_temp_down",
  "ac_temp",
  "fan_level",
  "trunk",
  "defrost",
  "rear_defrost",
  "seat_heat_driver",
  "seat_heat_pass",
  "steering_heat",
  "mirror_fold",
  "find_car",
  "honk",
  "flash_lights",
  "charge_port",
  "tts",
] as const;

export type VehicleCommandType = (typeof VEHICLE_COMMAND_TYPES)[number];

export type VehicleCommandParams = Record<string, unknown>;

const WINDOW_TARGETS: Record<string, string> = {
  driver: "主驾车窗",
  pass: "副驾车窗",
  rl: "左后车窗",
  rr: "右后车窗",
  all: "全部车窗",
};

const WINDOWS_PRESET_PHRASES: Record<string, string> = {
  vent: "车窗通风",
  close: "车窗关闭",
  open: "车窗全开",
  half: "车窗半开",
};

function containsDeniedPhrase(text: string) {
  return DIPLUS_DENY_PATTERNS.some((pattern) => text.includes(pattern));
}

function readInt(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
}

function readBool(value: unknown) {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return null;
}

export type AllowlistResult =
  | { ok: true; phrase: string }
  | { ok: false; error: string };

export function buildDiplusPhrase(
  type: string,
  params: VehicleCommandParams,
): AllowlistResult {
  if (!VEHICLE_COMMAND_TYPES.includes(type as VehicleCommandType)) {
    return { ok: false, error: `Unknown command type: ${type}` };
  }

  let phrase: string;

  switch (type) {
    case "lock":
      phrase = "车门上锁";
      break;
    case "unlock":
      phrase = "车门解锁";
      break;
    case "set_soc_limit": {
      const value = readInt(params.value);
      if (value == null || value < 50 || value > 100) {
        return { ok: false, error: "set_soc_limit.value must be 50–100" };
      }
      phrase = `设置SOC${value}`;
      break;
    }
    case "schedule_charge": {
      const hh = readInt(params.hh);
      const mm = readInt(params.mm);
      const end = readInt(params.end);
      if (hh == null || hh < 0 || hh > 23) return { ok: false, error: "schedule_charge.hh invalid" };
      if (mm == null || mm < 0 || mm > 59) return { ok: false, error: "schedule_charge.mm invalid" };
      if (end == null || end < 0 || end > 23) return { ok: false, error: "schedule_charge.end invalid" };
      phrase = `预约充电${hh}:${String(mm).padStart(2, "0")}-${end}`;
      break;
    }
    case "window": {
      const which = typeof params.which === "string" ? params.which : "";
      const cn = WINDOW_TARGETS[which];
      if (!cn) return { ok: false, error: "window.which invalid" };
      const pct = readInt(params.pct);
      if (pct == null || pct < 0 || pct > 100) return { ok: false, error: "window.pct must be 0–100" };
      phrase = `${cn}打开百分之${pct}`;
      break;
    }
    case "windows_preset": {
      const preset = typeof params.preset === "string" ? params.preset : "";
      const presetPhrase = WINDOWS_PRESET_PHRASES[preset];
      if (!presetPhrase) return { ok: false, error: "windows_preset.preset invalid" };
      phrase = presetPhrase;
      break;
    }
    case "ac": {
      const on = readBool(params.on);
      if (on == null) return { ok: false, error: "ac.on must be boolean" };
      phrase = on ? "自动空调" : "关闭空调";
      break;
    }
    case "ac_vent": {
      const on = readBool(params.on);
      if (on == null) return { ok: false, error: "ac_vent.on must be boolean" };
      phrase = on ? "打开空调通风" : "关闭空调";
      break;
    }
    case "sunroof": {
      const pct = readInt(params.pct);
      if (pct == null || pct < 0 || pct > 100) return { ok: false, error: "sunroof.pct must be 0–100" };
      phrase = `天窗打开百分之${pct}`;
      break;
    }
    case "sunshade": {
      const pct = readInt(params.pct);
      if (pct == null || pct < 0 || pct > 100) return { ok: false, error: "sunshade.pct must be 0–100" };
      phrase = `遮阳帘打开百分之${pct}`;
      break;
    }
    case "hud": {
      const on = readBool(params.on);
      if (on == null) return { ok: false, error: "hud.on must be boolean" };
      phrase = on ? "打开HUD" : "关闭HUD";
      break;
    }
    case "auto_highbeam": {
      const on = readBool(params.on);
      if (on == null) return { ok: false, error: "auto_highbeam.on must be boolean" };
      phrase = on ? "打开自动远光" : "关闭自动远光";
      break;
    }
    case "child_lock_left":
      phrase = "打开左童锁";
      break;
    // --- Extended set (sync with CommandAllowlist.kt + BYD_MA COMMAND_ALLOWLIST.md) ---
    case "sentry": {
      const on = readBool(params.on);
      if (on == null) return { ok: false, error: "sentry.on must be boolean" };
      phrase = on ? "开启哨兵模式" : "关闭哨兵模式";
      break;
    }
    case "sentry_autostart": {
      const on = readBool(params.on);
      if (on == null) return { ok: false, error: "sentry_autostart.on must be boolean" };
      phrase = on ? "开启自动启动哨兵模式" : "关闭自动启动哨兵模式";
      break;
    }
    case "screen_off":
      phrase = "屏幕关闭";
      break;
    case "windows_close":
      phrase = "一键关窗";
      break;
    case "ac_temp_up":
      phrase = "空调升温";
      break;
    case "ac_temp_down":
      phrase = "空调降温";
      break;
    case "ac_temp": {
      const value = readInt(params.value);
      if (value == null || value < 16 || value > 32) return { ok: false, error: "ac_temp.value must be 16–32" };
      phrase = `空调温度${value}度`;
      break;
    }
    case "fan_level": {
      const value = readInt(params.value);
      if (value == null || value < 0 || value > 7) return { ok: false, error: "fan_level.value must be 0–7" };
      phrase = `风量${value}档`;
      break;
    }
    case "trunk":
      phrase = "打开后备箱";
      break;
    case "defrost": {
      const on = readBool(params.on);
      if (on == null) return { ok: false, error: "defrost.on must be boolean" };
      phrase = on ? "打开除雾" : "关闭除雾";
      break;
    }
    case "rear_defrost": {
      const on = readBool(params.on);
      if (on == null) return { ok: false, error: "rear_defrost.on must be boolean" };
      phrase = on ? "打开后除霜" : "关闭后除霜";
      break;
    }
    case "seat_heat_driver": {
      const on = readBool(params.on);
      if (on == null) return { ok: false, error: "seat_heat_driver.on must be boolean" };
      phrase = on ? "打开主驾座椅加热" : "关闭主驾座椅加热";
      break;
    }
    case "seat_heat_pass": {
      const on = readBool(params.on);
      if (on == null) return { ok: false, error: "seat_heat_pass.on must be boolean" };
      phrase = on ? "打开副驾座椅加热" : "关闭副驾座椅加热";
      break;
    }
    case "steering_heat": {
      const on = readBool(params.on);
      if (on == null) return { ok: false, error: "steering_heat.on must be boolean" };
      phrase = on ? "打开方向盘加热" : "关闭方向盘加热";
      break;
    }
    case "mirror_fold": {
      const on = readBool(params.on);
      if (on == null) return { ok: false, error: "mirror_fold.on must be boolean" };
      phrase = on ? "折叠后视镜" : "展开后视镜";
      break;
    }
    case "find_car":
      phrase = "寻车";
      break;
    case "honk":
      phrase = "鸣笛";
      break;
    case "flash_lights":
      phrase = "闪灯";
      break;
    case "charge_port":
      phrase = "打开充电口";
      break;
    case "tts": {
      const text = typeof params.text === "string" ? params.text.trim() : "";
      if (!text || text.length > 80) return { ok: false, error: "tts.text must be 1–80 chars" };
      if (/[[\]]/.test(text)) return { ok: false, error: "tts.text must not contain brackets" };
      phrase = `播报${text}`;
      break;
    }
    default:
      return { ok: false, error: "Unsupported command type" };
  }

  if (containsDeniedPhrase(phrase)) {
    return { ok: false, error: "Built phrase matches deny-list" };
  }

  return { ok: true, phrase };
}

export function validateVehicleCommand(type: string, params: VehicleCommandParams) {
  return buildDiplusPhrase(type, params ?? {});
}
