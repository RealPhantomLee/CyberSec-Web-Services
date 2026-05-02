#include "httplib.h"
#include <nlohmann/json.hpp>
#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/rand.h>
#include "email.hpp"

#include <iostream>
#include <fstream>
#include <sstream>
#include <iomanip>
#include <string>
#include <vector>
#include <unordered_map>
#include <mutex>
#include <chrono>
#include <filesystem>
#include <algorithm>
#include <cstring>
#include <ctime>
#include <thread>

using json = nlohmann::json;
namespace fs = std::filesystem;
using namespace httplib;

static const std::string DATA_ROOT   = "data/";
static const std::string PUBLIC_ROOT = "public/";

// ── Session store ─────────────────────────────────────────────────────────────

struct Session { std::chrono::steady_clock::time_point expires; };
static std::mutex                              session_mtx;
static std::unordered_map<std::string,Session> sessions;
static int SESSION_SECONDS = 90;

static std::string generate_token() {
    unsigned char buf[32];
    RAND_bytes(buf, sizeof(buf));
    char hex[65] = {};
    for (int i = 0; i < 32; ++i)
        snprintf(hex + i * 2, 3, "%02x", buf[i]);
    return hex;
}

static std::string create_session() {
    std::lock_guard<std::mutex> lk(session_mtx);
    auto now = std::chrono::steady_clock::now();
    for (auto it = sessions.begin(); it != sessions.end();)
        it = (it->second.expires < now) ? sessions.erase(it) : ++it;
    std::string tok = generate_token();
    sessions[tok] = { now + std::chrono::seconds(SESSION_SECONDS) };
    return tok;
}

static bool validate_session(const std::string& tok) {
    if (tok.empty()) return false;
    std::lock_guard<std::mutex> lk(session_mtx);
    auto it = sessions.find(tok);
    if (it == sessions.end()) return false;
    if (it->second.expires < std::chrono::steady_clock::now()) {
        sessions.erase(it);
        return false;
    }
    return true;
}

static void destroy_session(const std::string& tok) {
    std::lock_guard<std::mutex> lk(session_mtx);
    sessions.erase(tok);
}

// ── Cookie parser ─────────────────────────────────────────────────────────────

static std::string get_cookie(const Request& req, const std::string& name) {
    auto it = req.headers.find("Cookie");
    if (it == req.headers.end()) return "";
    const std::string& hdr = it->second;
    std::string key = name + "=";
    auto pos = hdr.find(key);
    if (pos == std::string::npos) return "";
    pos += key.size();
    auto end = hdr.find(';', pos);
    return hdr.substr(pos, end == std::string::npos ? end : end - pos);
}

static bool check_auth(const Request& req) {
    return validate_session(get_cookie(req, "admin_session"));
}

// ── Rate limiter ──────────────────────────────────────────────────────────────

struct RateEntry { int count; std::chrono::steady_clock::time_point window_start; };
static std::mutex                               rate_mtx;
static std::unordered_map<std::string,RateEntry> login_rate, contact_rate;

static bool is_rate_limited(
    const std::string& ip,
    std::unordered_map<std::string,RateEntry>& map,
    int max_req, int window_sec)
{
    std::lock_guard<std::mutex> lk(rate_mtx);
    auto  now = std::chrono::steady_clock::now();
    auto& e   = map[ip];
    auto  elapsed = std::chrono::duration_cast<std::chrono::seconds>(
                        now - e.window_start).count();
    if (elapsed >= window_sec) { e = {1, now}; return false; }
    return ++e.count > max_req;
}

static std::string client_ip(const Request& req) {
    std::string cf = req.get_header_value("CF-Connecting-IP");
    if (!cf.empty()) return cf;
    std::string xff = req.get_header_value("X-Forwarded-For");
    if (!xff.empty()) return xff.substr(0, xff.find(','));
    return req.remote_addr;
}

// ── SHA-256 ───────────────────────────────────────────────────────────────────

static std::string sha256(const std::string& s) {
    unsigned char hash[SHA256_DIGEST_LENGTH];
    SHA256(reinterpret_cast<const unsigned char*>(s.c_str()), s.size(), hash);
    char hex[65] = {};
    for (int i = 0; i < SHA256_DIGEST_LENGTH; ++i)
        snprintf(hex + i * 2, 3, "%02x", hash[i]);
    return hex;
}

// ── JSON helpers ──────────────────────────────────────────────────────────────

static json load_json(const std::string& path) {
    std::ifstream f(path);
    if (!f.is_open()) return json::object();
    try { json j; f >> j; return j; }
    catch (...) { return json::object(); }
}

static std::mutex file_mtx;

static bool save_json(const std::string& path, const json& data) {
    std::lock_guard<std::mutex> lk(file_mtx);
    std::ofstream f(path);
    if (!f.is_open()) return false;
    f << data.dump(2);
    return f.good();
}

// ── Response helpers ──────────────────────────────────────────────────────────

static void json_ok(Response& res, const json& data) {
    res.status = 200;
    res.set_content(data.dump(), "application/json");
}

static void json_err(Response& res, int code, const std::string& msg) {
    res.status = code;
    res.set_content(json{{"error", msg}}.dump(), "application/json");
}

// ── libcurl response collector ────────────────────────────────────────────────

static size_t http_write_cb(char* ptr, size_t sz, size_t nmemb, void* ud) {
    static_cast<std::string*>(ud)->append(ptr, sz * nmemb);
    return sz * nmemb;
}

// ── ISO timestamp ─────────────────────────────────────────────────────────────

static std::string iso_now() {
    char buf[32];
    time_t t = time(nullptr);
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", gmtime(&t));
    return buf;
}

// ── Stripe webhook signature verification ────────────────────────────────────

static std::vector<unsigned char> b64_decode(const std::string& enc) {
    std::vector<unsigned char> out(enc.size());
    int len = EVP_DecodeBlock(out.data(),
        reinterpret_cast<const unsigned char*>(enc.data()), (int)enc.size());
    if (len < 0) return {};
    int pad = 0;
    if (!enc.empty() && enc.back() == '=') pad++;
    if (enc.size() > 1 && enc[enc.size()-2] == '=') pad++;
    out.resize(len - pad);
    return out;
}

static bool verify_stripe_sig(const std::string& payload,
                               const std::string& sig_header,
                               const std::string& secret) {
    std::string ts, v1;
    std::istringstream ss(sig_header);
    std::string part;
    while (std::getline(ss, part, ',')) {
        if (part.size() > 2 && part.substr(0,2) == "t=")  ts = part.substr(2);
        if (part.size() > 3 && part.substr(0,3) == "v1=") v1 = part.substr(3);
    }
    if (ts.empty() || v1.empty()) return false;

    long long now = std::chrono::duration_cast<std::chrono::seconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    long long diff = now - std::stoll(ts);
    if (diff > 300 || diff < -300) return false;

    std::string signed_payload = ts + "." + payload;
    std::string enc = (secret.size() > 6 && secret.substr(0,6) == "whsec_")
                    ? secret.substr(6) : secret;
    auto key = b64_decode(enc);
    if (key.empty()) return false;

    unsigned char hmac_out[EVP_MAX_MD_SIZE];
    unsigned int  hmac_len = 0;
    HMAC(EVP_sha256(), key.data(), (int)key.size(),
         reinterpret_cast<const unsigned char*>(signed_payload.data()),
         signed_payload.size(), hmac_out, &hmac_len);

    std::ostringstream hex;
    for (unsigned int i = 0; i < hmac_len; ++i)
        hex << std::hex << std::setw(2) << std::setfill('0') << (int)hmac_out[i];
    return hex.str() == v1;
}

// ── SMTP config from JSON ─────────────────────────────────────────────────────

static SmtpConfig load_smtp(const json& cfg) {
    SmtpConfig s;
    if (!cfg.contains("smtp")) return s;
    const auto& sc = cfg["smtp"];
    s.enabled     = sc.value("enabled",     false);
    s.host        = sc.value("host",        "smtp.gmail.com");
    s.port        = sc.value("port",        465);
    s.use_ssl     = sc.value("use_ssl",     true);
    s.username    = sc.value("username",    "");
    s.password    = sc.value("password",    "");
    s.from_name   = sc.value("from_name",   "Phantom Cyber Solutions");
    s.from_email  = sc.value("from_email",  "");
    s.admin_email = sc.value("admin_email", "");
    return s;
}

// ─────────────────────────────────────────────────────────────────────────────

int main() {
    json config = load_json(DATA_ROOT + "config.json");
    if (config.empty()) {
        std::cerr << "ERROR: Could not load " << DATA_ROOT << "config.json\n"
                  << "Run the server from the build directory.\n";
        return 1;
    }

    SESSION_SECONDS = config["admin"].value("session_seconds", 90);
    SmtpConfig smtp      = load_smtp(config);
    std::string adm_user = config["admin"].value("username",      "admin");
    std::string adm_hash = config["admin"].value("password_hash", "");
    int         port     = config["site"].value("port",           8080);

    std::string contacts_path = DATA_ROOT + "contacts.json";
    if (!fs::exists(contacts_path))
        save_json(contacts_path, json::array());

    curl_global_init(CURL_GLOBAL_ALL);

    Server svr;
    svr.new_task_queue = [] { return new ThreadPool(4); };

    // ── GET /api/services ────────────────────────────────────────────────────
    svr.Get("/api/services", [&](const Request&, Response& res) {
        json_ok(res, load_json(DATA_ROOT + "services.json"));
    });

    // ── GET /api/products ────────────────────────────────────────────────────
    svr.Get("/api/products", [&](const Request&, Response& res) {
        json_ok(res, load_json(DATA_ROOT + "products.json"));
    });

    // ── GET /api/blog ─────────────────────────────────────────────────────────
    svr.Get("/api/blog", [&](const Request&, Response& res) {
        json data = load_json(DATA_ROOT + "blog.json");
        json out  = json::array();
        for (auto& p : data.value("posts", json::array()))
            if (p.value("published", false)) out.push_back(p);
        json_ok(res, out);
    });

    // ── POST /api/contact ─────────────────────────────────────────────────────
    svr.Post("/api/contact", [&](const Request& req, Response& res) {
        if (is_rate_limited(client_ip(req), contact_rate, 3, 3600))
            return json_err(res, 429, "Too many submissions. Try again later.");

        json body;
        try { body = json::parse(req.body); }
        catch (...) { return json_err(res, 400, "Invalid request body."); }

        std::string name    = body.value("name",    "");
        std::string email   = body.value("email",   "");
        std::string message = body.value("message", "");

        if (name.empty() || email.empty() || message.empty())
            return json_err(res, 400, "Name, email, and message are required.");
        if (email.find('@') == std::string::npos || email.find('.') == std::string::npos)
            return json_err(res, 400, "Invalid email address.");

        json sub = {
            {"id",        std::to_string(
                          std::chrono::system_clock::now().time_since_epoch().count())},
            {"name",      name},
            {"email",     email},
            {"service",   body.value("service", "Not specified")},
            {"budget",    body.value("budget",  "Not specified")},
            {"message",   message},
            {"timestamp", iso_now()},
            {"read",      false}
        };

        // Persist submission
        {
            std::lock_guard<std::mutex> lk(file_mtx);
            json contacts;
            {
                std::ifstream f(contacts_path);
                try { f >> contacts; } catch (...) { contacts = json::array(); }
            }
            if (!contacts.is_array()) contacts = json::array();
            contacts.insert(contacts.begin(), sub);
            std::ofstream f(contacts_path);
            f << contacts.dump(2);
        }

        // Send emails in background so response isn't blocked
        std::thread([smtp_cfg = smtp, sub]() {
            send_contact_notification(smtp_cfg, sub);
            send_contact_reply(smtp_cfg, sub);
        }).detach();

        json_ok(res, {{"success", true}});
    });

    // ── POST /api/admin/login ─────────────────────────────────────────────────
    svr.Post("/api/admin/login", [&](const Request& req, Response& res) {
        if (is_rate_limited(client_ip(req), login_rate, 5, 900)) {
            res.set_header("Retry-After", "900");
            return json_err(res, 429, "Too many attempts. Try again in 15 minutes.");
        }
        json body;
        try { body = json::parse(req.body); }
        catch (...) { return json_err(res, 400, "Invalid request body."); }

        if (body.value("username","") == adm_user &&
            sha256(body.value("password","")) == adm_hash)
        {
            std::string tok = create_session();
            res.set_header("Set-Cookie",
                "admin_session=" + tok
                + "; Path=/; Max-Age=" + std::to_string(SESSION_SECONDS)
                + "; SameSite=Strict; HttpOnly");
            json_ok(res, {{"success", true}});
        } else {
            json_err(res, 401, "Invalid credentials.");
        }
    });

    // ── POST /api/admin/logout ────────────────────────────────────────────────
    svr.Post("/api/admin/logout", [&](const Request& req, Response& res) {
        destroy_session(get_cookie(req, "admin_session"));
        res.set_header("Set-Cookie",
            "admin_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; "
            "SameSite=Strict; HttpOnly");
        json_ok(res, {{"success", true}});
    });

    // ── GET /api/admin/contacts ───────────────────────────────────────────────
    svr.Get("/api/admin/contacts", [&](const Request& req, Response& res) {
        if (!check_auth(req)) return json_err(res, 403, "Unauthorized");
        json contacts = load_json(contacts_path);
        if (!contacts.is_array()) contacts = json::array();
        json_ok(res, contacts);
    });

    // ── POST /api/admin/contacts/read/:id ─────────────────────────────────────
    svr.Post(R"(/api/admin/contacts/read/(.+))", [&](const Request& req, Response& res) {
        if (!check_auth(req)) return json_err(res, 403, "Unauthorized");
        std::string id = req.matches[1];
        std::lock_guard<std::mutex> lk(file_mtx);
        json contacts = load_json(contacts_path);
        for (auto& c : contacts)
            if (c.value("id","") == id) c["read"] = true;
        std::ofstream f(contacts_path);
        f << contacts.dump(2);
        json_ok(res, {{"success", true}});
    });

    // ── POST /api/admin/blog ──────────────────────────────────────────────────
    svr.Post("/api/admin/blog", [&](const Request& req, Response& res) {
        if (!check_auth(req)) return json_err(res, 403, "Unauthorized");
        json body;
        try { body = json::parse(req.body); }
        catch (...) { return json_err(res, 400, "Invalid request body."); }

        std::string blog_path = DATA_ROOT + "blog.json";
        json data = load_json(blog_path);
        if (!data.contains("posts") || !data["posts"].is_array())
            data["posts"] = json::array();

        json post = {
            {"id",        body.value("id",        "post-" + std::to_string(time(nullptr)))},
            {"title",     body.value("title",     "")},
            {"date",      body.value("date",      "")},
            {"author",    "admin"},
            {"category",  body.value("category",  "general")},
            {"tags",      body.value("tags",      json::array())},
            {"excerpt",   body.value("excerpt",   "")},
            {"content",   body.value("content",   "")},
            {"published", body.value("published", false)},
        };

        data["posts"].push_back(post);
        save_json(blog_path, data);
        json_ok(res, {{"success", true}, {"id", post["id"]}});
    });

    // ── DELETE /api/admin/blog/:id ────────────────────────────────────────────
    svr.Delete(R"(/api/admin/blog/(.+))", [&](const Request& req, Response& res) {
        if (!check_auth(req)) return json_err(res, 403, "Unauthorized");
        std::string id  = req.matches[1];
        std::string bp  = DATA_ROOT + "blog.json";
        json data = load_json(bp);
        if (!data.contains("posts"))
            return json_err(res, 404, "Not found");
        auto& posts  = data["posts"];
        auto  before = posts.size();
        posts.erase(
            std::remove_if(posts.begin(), posts.end(),
                [&id](const json& p){ return p.value("id","") == id; }),
            posts.end());
        if (posts.size() == before)
            return json_err(res, 404, "Post not found");
        save_json(bp, data);
        json_ok(res, {{"success", true}});
    });

    // ── GET /api/admin/analytics ──────────────────────────────────────────────
    svr.Get("/api/admin/analytics", [&](const Request& req, Response& res) {
        if (!check_auth(req)) return json_err(res, 403, "Unauthorized");
        json contacts = load_json(contacts_path);
        int total = 0, unread = 0;
        if (contacts.is_array()) {
            total = (int)contacts.size();
            for (auto& c : contacts)
                if (!c.value("read", true)) ++unread;
        }
        json_ok(res, {
            {"total_contacts",  total},
            {"unread_contacts", unread}
        });
    });

    // ── POST /api/checkout/create-session ────────────────────────────────────
    svr.Post("/api/checkout/create-session", [&](const Request& req, Response& res) {
        std::string secret_key = config["stripe"].value("secret_key", "");
        if (secret_key.empty())
            return json_err(res, 503, "Stripe not configured.");

        json body;
        try { body = json::parse(req.body); }
        catch (...) { return json_err(res, 400, "Invalid request body."); }

        auto items = body.value("items", json::array());
        if (!items.is_array() || items.empty())
            return json_err(res, 400, "Cart is empty.");

        // Build URL-encoded Stripe form body (values only, not bracket keys)
        std::string form;
        auto append_field = [&](const std::string& key, const std::string& val) {
            if (!form.empty()) form += '&';
            char* enc = curl_easy_escape(nullptr, val.c_str(), (int)val.size());
            form += key + "=" + (enc ? enc : val);
            curl_free(enc);
        };

        for (size_t i = 0; i < items.size(); ++i) {
            std::string p = "line_items[" + std::to_string(i) + "]";
            append_field(p + "[price_data][currency]",           "usd");
            append_field(p + "[price_data][product_data][name]", items[i].value("name", "Item"));
            append_field(p + "[price_data][unit_amount]",        std::to_string(items[i].value("price", 0)));
            append_field(p + "[quantity]",                       "1");
        }
        append_field("mode",        "payment");
        append_field("success_url", "https://phantomcybersolutions.com/checkout?success=1");
        append_field("cancel_url",  "https://phantomcybersolutions.com/checkout?cancelled=1");

        std::string resp_body;
        std::string userpwd = secret_key + ":";
        CURL* c = curl_easy_init();
        if (!c) return json_err(res, 500, "Internal error.");

        curl_easy_setopt(c, CURLOPT_URL,           "https://api.stripe.com/v1/checkout/sessions");
        curl_easy_setopt(c, CURLOPT_USERPWD,       userpwd.c_str());
        curl_easy_setopt(c, CURLOPT_POSTFIELDS,    form.c_str());
        curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, http_write_cb);
        curl_easy_setopt(c, CURLOPT_WRITEDATA,     &resp_body);
        curl_easy_setopt(c, CURLOPT_TIMEOUT,       15L);

        CURLcode rc = curl_easy_perform(c);
        curl_easy_cleanup(c);

        if (rc != CURLE_OK)
            return json_err(res, 502, "Failed to reach Stripe.");

        json stripe_resp;
        try { stripe_resp = json::parse(resp_body); }
        catch (...) { return json_err(res, 502, "Invalid Stripe response."); }

        if (!stripe_resp.contains("url"))
            return json_err(res, 502,
                stripe_resp.value("error", json::object()).value("message", "Stripe error."));

        json_ok(res, {{"url", stripe_resp["url"]}});
    });

    // ── POST /api/stripe/webhook ──────────────────────────────────────────────
    svr.Post("/api/stripe/webhook", [&](const Request& req, Response& res) {
        std::string sig_header = req.get_header_value("Stripe-Signature");
        if (sig_header.empty())
            return json_err(res, 400, "Missing Stripe-Signature header.");

        std::string secret = config["stripe"].value("webhook_secret", "");
        if (secret.empty())
            return json_err(res, 503, "Stripe webhook not configured.");

        if (!verify_stripe_sig(req.body, sig_header, secret))
            return json_err(res, 400, "Invalid signature.");

        json event;
        try { event = json::parse(req.body); }
        catch (...) { return json_err(res, 400, "Invalid JSON."); }

        std::string event_type = event.value("type", "");
        std::string event_id   = event.value("id",   "");

        // Log event to payments.json
        std::string payments_path = DATA_ROOT + "payments.json";
        {
            std::lock_guard<std::mutex> lk(file_mtx);
            json payments = load_json(payments_path);
            if (!payments.contains("events") || !payments["events"].is_array())
                payments["events"] = json::array();
            json entry;
            entry["id"]        = event_id;
            entry["type"]      = event_type;
            entry["timestamp"] = iso_now();
            entry["data"]      = event.value("data", json::object());
            payments["events"].insert(payments["events"].begin(), entry);
            if (payments["events"].size() > 1000)
                payments["events"].erase(payments["events"].end() - 1);
            std::ofstream f(payments_path);
            f << payments.dump(2);
        }

        // Email notification on successful payment
        if (event_type == "checkout.session.completed" ||
            event_type == "payment_intent.succeeded") {
            auto& obj   = event["data"]["object"];
            long long c = obj.value("amount_total", obj.value("amount", 0LL));
            std::string amount = std::to_string(c / 100) + "."
                               + (c % 100 < 10 ? "0" : "")
                               + std::to_string(c % 100) + " "
                               + obj.value("currency", "usd");
            std::string cust   = obj.value("customer_email",
                                     obj.value("receipt_email", std::string("unknown")));
            std::thread([smtp_cfg = smtp, event_type, event_id, amount, cust]() {
                std::string subj = "[PHANTOM] Payment received — " + amount;
                std::string text =
                    "PHANTOM CYBER SOLUTIONS // PAYMENT RECEIVED\n"
                    "============================================\n\n"
                    "Event:    " + event_type + "\n"
                    "Amount:   " + amount     + "\n"
                    "Customer: " + cust       + "\n"
                    "Event ID: " + event_id   + "\n";
                std::string html =
                    "<p><b>Event:</b> "    + event_type + "<br>"
                    "<b>Amount:</b> "      + amount     + "<br>"
                    "<b>Customer:</b> "    + cust       + "<br>"
                    "<b>Event ID:</b> "    + event_id   + "</p>";
                smtp_send(smtp_cfg, smtp_cfg.admin_email, subj, text, html);
            }).detach();
        }

        json_ok(res, {{"received", true}});
    });

    // ── Static files ──────────────────────────────────────────────────────────
    if (!svr.set_mount_point("/", PUBLIC_ROOT)) {
        std::cerr << "ERROR: Public root '" << PUBLIC_ROOT << "' not found.\n"
                  << "Run the server from the build directory.\n";
        return 1;
    }

    // Custom 404
    svr.set_error_handler([](const Request&, Response& res) {
        if (res.status == 404) {
            std::ifstream f(PUBLIC_ROOT + "404.html", std::ios::binary);
            if (f) {
                std::string body((std::istreambuf_iterator<char>(f)), {});
                res.set_content(body, "text/html; charset=utf-8");
            }
        }
    });

    std::cout << "=== Phantom Cyber Solutions ===\n"
              << "Listening on port " << port       << "\n"
              << "Public root:  "     << PUBLIC_ROOT << "\n"
              << "Data root:    "     << DATA_ROOT   << "\n"
              << "Session TTL:  "     << SESSION_SECONDS << "s\n"
              << "Email:        "     << (smtp.enabled ? "enabled" : "disabled (configure smtp in data/config.json)") << "\n\n";

    svr.listen("0.0.0.0", port);

    curl_global_cleanup();
    return 0;
}
