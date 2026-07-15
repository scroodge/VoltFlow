#!/usr/bin/env python3
import base64
import hashlib
import hmac
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def load_env_file(path):
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


load_env_file(".env")
load_env_file(".env.local")

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
ANON_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
SITE_URL = os.environ.get("NEXT_PUBLIC_SITE_URL", "https://voltflow.life").rstrip("/")
CORS_ORIGIN = os.environ.get("TELEGRAM_CORS_ORIGIN", SITE_URL)
PORT = int(os.environ.get("TELEGRAM_API_PORT") or os.environ.get("PORT") or "8787")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "").rstrip("/")
LLM_MODEL = os.environ.get("LLM_MODEL", "")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_MAX_TOKENS = int(os.environ.get("LLM_MAX_TOKENS") or "512")


if not all([BOT_TOKEN, SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY]):
    print(
        "Missing required env: TELEGRAM_BOT_TOKEN, NEXT_PUBLIC_SUPABASE_URL, "
        "NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
        file=sys.stderr,
    )
    sys.exit(1)


class TelegramApiHandler(BaseHTTPRequestHandler):
    server_version = "VoltFlowTelegramApi/1.0"

    def do_OPTIONS(self):
        self.send_response(204)
        self.write_cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self.write_json(200, {"ok": True, "service": "telegram-miniapp"})
            return
        self.write_json(404, {"ok": False, "error": "not_found"})

    def do_POST(self):
        try:
            path = urllib.parse.urlparse(self.path).path
            if path == "/api/telegram/auth":
                self.handle_auth()
                return
            if path == "/api/telegram/link":
                self.handle_link()
                return
            if path == "/api/telegram/webhook":
                self.handle_webhook()
                return
            self.write_json(404, {"ok": False, "error": "not_found"})
        except Exception as exc:
            print(f"request failed: {exc}", file=sys.stderr)
            self.write_json(500, {"ok": False, "error": "server_error"})

    def handle_auth(self):
        body = self.read_json()
        init_data = body.get("initData") if isinstance(body, dict) else ""
        verified = verify_telegram_init_data(init_data or "")
        if not verified["ok"]:
            self.write_json(401, {"ok": False, "error": verified["error"]})
            return

        tg_user = verified["user"]
        telegram_id = tg_user["id"]
        email = f"tg_{telegram_id}@telegram.voltflow"
        username = tg_user.get("username")

        linked = supabase_select_one(
            "profiles",
            {
                "select": "id,email",
                "telegram_id": f"eq.{telegram_id}",
            },
        )

        if linked:
            user_id = linked["id"]
            user_email = linked.get("email") or email
        else:
            by_email = supabase_select_one(
                "profiles",
                {
                    "select": "id,email",
                    "email": f"eq.{email}",
                },
            )
            if by_email:
                user_id = by_email["id"]
                user_email = by_email.get("email") or email
            else:
                created = supabase_auth_admin(
                    "POST",
                    "/admin/users",
                    {
                        "email": email,
                        "email_confirm": True,
                        "user_metadata": {
                            "telegram_id": telegram_id,
                            "telegram_username": username,
                            "full_name": " ".join(
                                part
                                for part in [tg_user.get("first_name"), tg_user.get("last_name")]
                                if part
                            )
                            or None,
                        },
                    },
                )
                user_id = created.get("id")
                if not user_id:
                    self.write_json(500, {"ok": False, "error": "create_failed"})
                    return
                user_email = email

            try:
                supabase_update_profile(user_id, telegram_id, username)
            except RuntimeError as exc:
                self.write_json(500, {"ok": False, "error": "link_failed", "detail": str(exc)})
                return

        link = supabase_auth_admin(
            "POST",
            "/admin/generate_link",
            {"type": "magiclink", "email": user_email},
        )
        token_hash = (
            link.get("properties", {}).get("hashed_token")
            or link.get("hashed_token")
            or link.get("action_link", "").split("token_hash=", 1)[-1].split("&", 1)[0]
        )
        if not token_hash:
            self.write_json(500, {"ok": False, "error": "session_failed", "detail": "missing_token_hash"})
            return

        session = supabase_auth_anon(
            "POST",
            "/verify",
            {"type": "magiclink", "token_hash": urllib.parse.unquote(token_hash)},
        )
        access_token = session.get("access_token")
        refresh_token = session.get("refresh_token")
        if not access_token or not refresh_token:
            self.write_json(500, {"ok": False, "error": "verify_failed"})
            return

        self.write_json(
            200,
            {
                "ok": True,
                "access_token": access_token,
                "refresh_token": refresh_token,
                "telegram_id": telegram_id,
            },
        )

    def handle_link(self):
        auth = self.headers.get("authorization", "")
        if not auth.lower().startswith("bearer "):
            self.write_json(401, {"ok": False, "error": "not_authenticated"})
            return

        access_token = auth.split(" ", 1)[1].strip()
        user = supabase_auth_get_user(access_token)
        if not user or not user.get("id"):
            self.write_json(401, {"ok": False, "error": "not_authenticated"})
            return

        body = self.read_json()
        init_data = body.get("initData") if isinstance(body, dict) else ""
        verified = verify_telegram_init_data(init_data or "")
        if not verified["ok"]:
            self.write_json(401, {"ok": False, "error": verified["error"]})
            return

        tg_user = verified["user"]
        try:
            supabase_update_profile(user["id"], tg_user["id"], tg_user.get("username"))
        except RuntimeError:
            self.write_json(500, {"ok": False, "error": "link_failed"})
            return

        self.write_json(200, {"ok": True, "telegram_id": tg_user["id"]})

    def handle_webhook(self):
        secret = os.environ.get("TELEGRAM_WEBHOOK_SECRET")
        if secret and self.headers.get("x-telegram-bot-api-secret-token") != secret:
            self.write_json(401, {"ok": False, "error": "unauthorized"})
            return

        update = self.read_json(required=False)
        message = (update or {}).get("message") or (update or {}).get("edited_message") or {}
        chat_id = (message.get("chat") or {}).get("id")
        if not chat_id:
            self.write_json(200, {"ok": True})
            return

        text = (message.get("text") or message.get("caption") or "").strip()
        if text.startswith("/start") or text.startswith("/app") or text == "":
            send_telegram_message(chat_id)

        event = normalize_group_event(update or {})
        if event:
            try:
                upsert_telegram_group_event(event)
                threading.Thread(
                    target=process_telegram_group_event,
                    args=(event,),
                    daemon=True,
                ).start()
            except RuntimeError as exc:
                # Telegram should still receive a fast success response. The
                # update_id/message identity makes a later retry idempotent.
                print(f"telegram group event store failed: {exc}", file=sys.stderr)

        self.write_json(200, {"ok": True})

    def read_json(self, required=True):
        size = int(self.headers.get("content-length") or "0")
        if size <= 0:
            return {}
        raw = self.rfile.read(size).decode("utf-8")
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            if required:
                raise
            return {}

    def write_json(self, status, payload):
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.write_cors_headers()
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def write_cors_headers(self):
        self.send_header("access-control-allow-origin", CORS_ORIGIN)
        self.send_header("access-control-allow-credentials", "true")
        self.send_header("vary", "Origin")
        self.send_header("access-control-allow-methods", "GET,POST,OPTIONS")
        self.send_header(
            "access-control-allow-headers",
            "content-type,authorization,x-telegram-bot-api-secret-token",
        )

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} - {fmt % args}")


def verify_telegram_init_data(init_data, max_age_seconds=86400):
    if not init_data:
        return {"ok": False, "error": "missing_init_data"}

    pairs = urllib.parse.parse_qsl(init_data, keep_blank_values=True)
    values = dict(pairs)
    received_hash = values.get("hash", "")
    auth_date_raw = values.get("auth_date", "")
    user_raw = values.get("user", "")

    if not received_hash:
        return {"ok": False, "error": "missing_hash"}
    if not auth_date_raw:
        return {"ok": False, "error": "missing_auth_date"}
    if not user_raw:
        return {"ok": False, "error": "missing_user"}

    check_pairs = sorted((key, value) for key, value in pairs if key != "hash")
    data_check_string = "\n".join(f"{key}={value}" for key, value in check_pairs)
    secret = hmac.new(b"WebAppData", BOT_TOKEN.encode("utf-8"), hashlib.sha256).digest()
    expected_hash = hmac.new(secret, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(received_hash, expected_hash):
        return {"ok": False, "error": "bad_hash"}

    try:
        auth_date = int(auth_date_raw)
    except ValueError:
        return {"ok": False, "error": "bad_auth_date"}
    if int(time.time()) - auth_date > max_age_seconds:
        return {"ok": False, "error": "expired"}

    try:
        user = json.loads(user_raw)
    except json.JSONDecodeError:
        return {"ok": False, "error": "bad_user"}
    if not isinstance(user.get("id"), int):
        return {"ok": False, "error": "bad_user"}

    return {"ok": True, "user": user}


def supabase_select_one(table, params):
    path = f"/rest/v1/{table}?{urllib.parse.urlencode(params)}"
    data = supabase_request("GET", path, key=SERVICE_ROLE_KEY)
    if not isinstance(data, list) or not data:
        return None
    return data[0]


def supabase_update_profile(user_id, telegram_id, username):
    params = urllib.parse.urlencode({"id": f"eq.{user_id}"})
    supabase_request(
        "PATCH",
        f"/rest/v1/profiles?{params}",
        {
            "telegram_id": telegram_id,
            "telegram_username": username,
        },
        key=SERVICE_ROLE_KEY,
        headers={"prefer": "return=minimal"},
        expect_empty=True,
    )


def supabase_auth_admin(method, path, payload=None):
    return supabase_request(method, f"/auth/v1{path}", payload, key=SERVICE_ROLE_KEY)


def supabase_auth_anon(method, path, payload=None):
    return supabase_request(method, f"/auth/v1{path}", payload, key=ANON_KEY)


def supabase_auth_get_user(access_token):
    try:
        return supabase_request(
            "GET",
            "/auth/v1/user",
            key=ANON_KEY,
            headers={"authorization": f"Bearer {access_token}"},
        )
    except RuntimeError:
        return None


def supabase_request(method, path, payload=None, key="", headers=None, expect_empty=False):
    body = None
    request_headers = {
        "apikey": key,
        "authorization": f"Bearer {key}",
        "content-type": "application/json",
        "accept": "application/json",
    }
    if headers:
        request_headers.update(headers)
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")

    request = urllib.request.Request(
        f"{SUPABASE_URL}{path}",
        data=body,
        method=method,
        headers=request_headers,
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"supabase_http_{exc.code}:{detail[:300]}") from exc

    if expect_empty or not raw:
        return None
    return json.loads(raw)


def normalize_group_event(update):
    edited = bool(update.get("edited_message"))
    message = update.get("edited_message") or update.get("message") or {}
    chat = message.get("chat") or {}
    chat_type = chat.get("type")
    message_id = message.get("message_id")
    chat_id = chat.get("id")
    if chat_type not in {"group", "supergroup"} or message_id is None or chat_id is None:
        return None

    user = message.get("from") or {}
    media_type, media_file_id = resolve_group_media(message)
    chat_username = clean_telegram_username(chat.get("username"))
    source_url = f"https://t.me/{chat_username}/{message_id}" if chat_username else None

    return {
        "update_id": update.get("update_id"),
        "event_type": "edited" if edited else "new",
        "chat_id": chat_id,
        "chat_type": chat_type,
        "chat_title": (chat.get("title") or "").strip() or None,
        "chat_username": chat_username,
        "message_id": message_id,
        "telegram_user_id": user.get("id"),
        "username": clean_telegram_username(user.get("username")),
        "display_name": " ".join(
            part for part in [user.get("first_name"), user.get("last_name")] if part
        ) or None,
        "sent_at": telegram_time_to_iso(message.get("date")),
        "edited_at": telegram_time_to_iso(message.get("edit_date")),
        "text": (message.get("text") or message.get("caption") or "").strip(),
        "reply_to_message_id": (message.get("reply_to_message") or {}).get("message_id"),
        "media_type": media_type,
        "media_file_id": media_file_id,
        "protected_content": message.get("has_protected_content") is True,
        "source_url": source_url,
        "raw_update": update,
    }


def upsert_telegram_group_event(event):
    supabase_request(
        "POST",
        "/rest/v1/telegram_group_events?on_conflict=chat_id%2Cmessage_id",
        event,
        key=SERVICE_ROLE_KEY,
        headers={"prefer": "resolution=merge-duplicates,return=minimal"},
        expect_empty=True,
    )


def process_telegram_group_event(event):
    if event["protected_content"]:
        update_telegram_group_verification(
            event,
            {
                "status": "ignored",
                "last_error": "protected_content",
                "processed_at": utc_now(),
            },
        )
        return
    if not event["text"]:
        update_telegram_group_verification(
            event,
            {"status": "ignored", "last_error": "empty_text", "processed_at": utc_now()},
        )
        return
    if not LLM_BASE_URL or not LLM_MODEL or not LLM_API_KEY:
        update_telegram_group_verification(
            event,
            {"status": "failed", "last_error": "llm_not_configured", "processed_at": utc_now()},
        )
        return

    try:
        result = verify_telegram_text(event["text"])
        if result["actionable"]:
            upsert_community_listing(event, result)
        update_telegram_group_verification(
            event,
            {
                "status": "processed",
                "intent": result["intent"],
                "confidence": result["confidence"],
                "title": result["title"],
                "item_type": result["item_type"],
                "city": result["city"],
                "generation": result["generation"],
                "price": result["price"],
                "currency": result["currency"],
                "contact": result["contact"],
                "actionable": result["actionable"],
                "needs_review": result["needs_review"],
                "verification_reason": result["reason"],
                "verified_at": utc_now(),
                "processed_at": utc_now(),
                "last_error": None,
            },
        )
    except Exception as exc:
        print(f"telegram group event verification failed: {exc}", file=sys.stderr)
        update_telegram_group_verification(
            event,
            {"status": "failed", "last_error": "llm_request_failed", "processed_at": utc_now()},
        )


def update_telegram_group_verification(event, values):
    query = urllib.parse.urlencode(
        {"chat_id": f"eq.{event['chat_id']}", "message_id": f"eq.{event['message_id']}"}
    )
    supabase_request(
        "PATCH",
        f"/rest/v1/telegram_group_events?{query}",
        values,
        key=SERVICE_ROLE_KEY,
        headers={"prefer": "return=minimal"},
        expect_empty=True,
    )


def upsert_community_listing(event, result):
    listing = {
        "telegram_user_id": event["telegram_user_id"],
        "listing_type": result["intent"],
        "title": result["title"] or event["text"][:120],
        "description": event["text"],
        "item_type": result["item_type"] or "other",
        "city": result["city"],
        "generation": result["generation"],
        "price": result["price"],
        "currency": result["currency"],
        "contact_link": event["source_url"],
        "source_chat_id": event["chat_id"],
        "source_message_id": event["message_id"],
        # Edits return a published listing to draft for fresh moderation.
        "status": "draft",
    }
    supabase_request(
        "POST",
        "/rest/v1/community_listings?on_conflict=source_chat_id%2Csource_message_id",
        listing,
        key=SERVICE_ROLE_KEY,
        headers={"prefer": "resolution=merge-duplicates,return=minimal"},
        expect_empty=True,
    )


def process_pending_group_events():
    rows = supabase_request(
        "GET",
        "/rest/v1/telegram_group_events?status=eq.pending&select=*",
        key=SERVICE_ROLE_KEY,
    ) or []
    for row in rows:
        event = {
            "protected_content": row.get("protected_content") is True,
            "text": row.get("text") or "",
            "chat_id": row.get("chat_id"),
            "message_id": row.get("message_id"),
            "telegram_user_id": row.get("telegram_user_id"),
            "source_url": row.get("source_url"),
        }
        process_telegram_group_event(event)


def verify_telegram_text(text):
    base_url = LLM_BASE_URL if LLM_BASE_URL.endswith("/v1") else f"{LLM_BASE_URL}/v1"
    prompt = (
        "You verify Telegram group messages for a BYD Yuan UP community marketplace. "
        "Return ONLY valid JSON with keys: intent, confidence, title, item_type, city, "
        "generation, price, currency, contact, actionable, needs_review, reason. "
        "intent must be sell, wanted, service, question, irrelevant, or ambiguous. "
        "item_type must be accessory, spare_part, service, car, other, or null. "
        "Never invent details. actionable is true only for a clear sell, wanted, or service. "
        "Set needs_review true when ambiguous or unsafe."
    )
    payload = {
        "model": LLM_MODEL,
        "temperature": 0,
        "max_tokens": LLM_MAX_TOKENS,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": text},
        ],
    }
    request = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "authorization": f"Bearer {LLM_API_KEY}",
            "content-type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        body = json.loads(response.read().decode("utf-8"))
    content = (((body.get("choices") or [{}])[0]).get("message") or {}).get("content") or ""
    content = content.strip().removeprefix("```json").removesuffix("```").strip()
    value = json.loads(content)
    return normalize_verification_result(value)


def normalize_verification_result(value):
    intents = {"sell", "wanted", "service", "question", "irrelevant", "ambiguous"}
    item_types = {"accessory", "spare_part", "service", "car", "other"}
    intent = value.get("intent") if value.get("intent") in intents else "ambiguous"
    confidence = value.get("confidence") if isinstance(value.get("confidence"), (int, float)) else 0
    confidence = max(0, min(1, confidence))
    needs_review = bool(value.get("needs_review")) or intent == "ambiguous" or confidence < 0.75
    actionable = bool(value.get("actionable")) and intent in {"sell", "wanted", "service"} and not needs_review
    return {
        "intent": intent,
        "confidence": confidence,
        "title": value.get("title") if isinstance(value.get("title"), str) else None,
        "item_type": value.get("item_type") if value.get("item_type") in item_types else None,
        "city": value.get("city") if isinstance(value.get("city"), str) else None,
        "generation": value.get("generation") if isinstance(value.get("generation"), str) else None,
        "price": value.get("price") if isinstance(value.get("price"), (int, float)) else None,
        "currency": value.get("currency") if isinstance(value.get("currency"), str) else None,
        "contact": value.get("contact") if isinstance(value.get("contact"), str) else None,
        "actionable": actionable,
        "needs_review": needs_review,
        "reason": value.get("reason") if isinstance(value.get("reason"), str) else "No explanation returned.",
    }


def utc_now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def clean_telegram_username(username):
    value = str(username or "").strip().lstrip("@")
    return value or None


def telegram_time_to_iso(value):
    if not isinstance(value, (int, float)):
        return None
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(value))


def resolve_group_media(message):
    photos = message.get("photo") or []
    if photos and photos[-1].get("file_id"):
        return "photo", photos[-1]["file_id"]
    for media_type in ["video", "document", "audio", "voice", "sticker"]:
        media = message.get(media_type) or {}
        if media.get("file_id"):
            return media_type, media["file_id"]
    return None, None


def send_telegram_message(chat_id):
    web_app_url = os.environ.get("TELEGRAM_WEB_APP_URL") or f"{SITE_URL}/telegram"
    telegram_request(
        "sendMessage",
        {
            "chat_id": chat_id,
            "text": "VoltFlow готов. Откройте приложение, чтобы смотреть зарядку, поездки и сервис BYD.",
            "reply_markup": {
                "inline_keyboard": [[{"text": "Открыть VoltFlow", "web_app": {"url": web_app_url}}]]
            },
            "disable_web_page_preview": True,
        },
    )


def telegram_request(method, payload):
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{BOT_TOKEN}/{method}",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        print(f"telegram {method} failed: {exc}", file=sys.stderr)
        return None


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), TelegramApiHandler)
    threading.Thread(target=process_pending_group_events, daemon=True).start()
    print(f"Telegram Mini App API listening on 127.0.0.1:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
