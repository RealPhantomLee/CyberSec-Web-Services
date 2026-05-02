#pragma once
#include <string>
#include <sstream>
#include <ctime>
#include <cstring>
#include <curl/curl.h>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

// ── Config ────────────────────────────────────────────────────────────────────

struct SmtpConfig {
    std::string host       = "smtp.gmail.com";
    int         port       = 465;
    bool        use_ssl    = true;
    std::string username;
    std::string password;
    std::string from_name  = "Phantom Cyber Solutions";
    std::string from_email;
    std::string admin_email;
    bool        enabled    = false;
};

// ── Internal MIME / SMTP helpers ──────────────────────────────────────────────

namespace email_detail {

struct UploadCtx { std::string data; size_t pos = 0; };

static size_t read_cb(char* buf, size_t sz, size_t n, void* p) {
    auto* ctx = static_cast<UploadCtx*>(p);
    size_t avail = ctx->data.size() - ctx->pos;
    if (!avail) return 0;
    size_t copy = std::min(sz * n, avail);
    std::memcpy(buf, ctx->data.c_str() + ctx->pos, copy);
    ctx->pos += copy;
    return copy;
}

static std::string rfc2822_now() {
    char buf[64];
    time_t t = time(nullptr);
    strftime(buf, sizeof(buf), "%a, %d %b %Y %H:%M:%S +0000", gmtime(&t));
    return buf;
}

static std::string build_mime(
    const std::string& from_name, const std::string& from_email,
    const std::string& to,        const std::string& subject,
    const std::string& text,      const std::string& html)
{
    std::string b = "=_PCS_" + std::to_string(time(nullptr)) + "_=";
    std::ostringstream m;
    m << "Date: "    << rfc2822_now()                            << "\r\n"
      << "To: "      << to                                       << "\r\n"
      << "From: "    << from_name << " <" << from_email << ">"  << "\r\n"
      << "Subject: " << subject                                  << "\r\n"
      << "MIME-Version: 1.0\r\n"
      << "Content-Type: multipart/alternative; boundary=\"" << b << "\"\r\n"
      << "\r\n"
      << "--" << b << "\r\n"
      << "Content-Type: text/plain; charset=utf-8\r\n\r\n"
      << text << "\r\n\r\n"
      << "--" << b << "\r\n"
      << "Content-Type: text/html; charset=utf-8\r\n\r\n"
      << html << "\r\n\r\n"
      << "--" << b << "--\r\n";
    return m.str();
}

} // namespace email_detail

// ── Core SMTP send (libcurl) ──────────────────────────────────────────────────

static bool smtp_send(
    const SmtpConfig&  cfg,
    const std::string& to,
    const std::string& subject,
    const std::string& text,
    const std::string& html)
{
    if (!cfg.enabled) return true;

    CURL* c = curl_easy_init();
    if (!c) return false;

    std::string url = (cfg.use_ssl ? "smtps://" : "smtp://")
                    + cfg.host + ":" + std::to_string(cfg.port);

    email_detail::UploadCtx ctx;
    ctx.data = email_detail::build_mime(
        cfg.from_name, cfg.from_email, to, subject, text, html);

    struct curl_slist* rcpt = curl_slist_append(nullptr,
        ("<" + to + ">").c_str());

    curl_easy_setopt(c, CURLOPT_URL,          url.c_str());
    curl_easy_setopt(c, CURLOPT_USE_SSL,      (long)CURLUSESSL_ALL);
    curl_easy_setopt(c, CURLOPT_USERNAME,     cfg.username.c_str());
    curl_easy_setopt(c, CURLOPT_PASSWORD,     cfg.password.c_str());
    curl_easy_setopt(c, CURLOPT_MAIL_FROM,    ("<" + cfg.from_email + ">").c_str());
    curl_easy_setopt(c, CURLOPT_MAIL_RCPT,    rcpt);
    curl_easy_setopt(c, CURLOPT_READFUNCTION, email_detail::read_cb);
    curl_easy_setopt(c, CURLOPT_READDATA,     &ctx);
    curl_easy_setopt(c, CURLOPT_UPLOAD,       1L);
    curl_easy_setopt(c, CURLOPT_TIMEOUT,      30L);
    curl_easy_setopt(c, CURLOPT_VERBOSE,      0L);

    CURLcode rc = curl_easy_perform(c);
    curl_slist_free_all(rcpt);
    curl_easy_cleanup(c);
    return rc == CURLE_OK;
}

// ── HTML escape ───────────────────────────────────────────────────────────────

static std::string he(const std::string& s) {
    std::string o; o.reserve(s.size());
    for (char c : s) {
        if      (c == '&') o += "&amp;";
        else if (c == '<') o += "&lt;";
        else if (c == '>') o += "&gt;";
        else if (c == '"') o += "&quot;";
        else               o += c;
    }
    return o;
}

// ── Shared email chrome ───────────────────────────────────────────────────────

static std::string email_header(const std::string& banner_tag) {
    std::ostringstream o;
    o << R"(<!DOCTYPE html><html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Phantom Cyber Solutions</title>
<style>
@keyframes flicker{0%,87%,89%,91%,100%{opacity:1}88%,90%{opacity:.6}}
@keyframes glitch{
  0%,100%{text-shadow:none;transform:none}
  6%{text-shadow:-2px 0 #ff0040,2px 0 #00e5ff;transform:translateX(-1px)}
  12%{text-shadow:2px 0 #ff0040,-2px 0 #00e5ff;transform:translateX(1px)}
  18%{text-shadow:none;transform:none}
}
.g{animation:glitch 7s infinite,flicker 11s infinite;display:inline-block}
</style>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;-webkit-text-size-adjust:100%">
<table width="100%" cellpadding="0" cellspacing="0" border="0"
  style="background:#0a0a0a;padding:32px 16px">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" border="0"
  style="max-width:580px;width:100%">

<tr>
  <td style="background:#141414;border-top:3px solid #E2E800;
             border-left:1px solid #1e1e1e;border-right:1px solid #1e1e1e;
             padding:28px 32px;text-align:center">
    <div class="g"
      style="font-family:'Courier New',Courier,monospace;font-size:22px;
             font-weight:700;color:#E2E800;letter-spacing:6px;text-transform:uppercase">
      PHANTOM CYBER
    </div>
    <div style="font-family:'Courier New',Courier,monospace;font-size:10px;
                color:#E2E800;letter-spacing:3px;opacity:.45;margin-top:4px">
      // SOLUTIONS
    </div>
  </td>
</tr>
<tr>
  <td style="background:#E2E800;padding:7px 32px">
    <span style="font-family:'Courier New',Courier,monospace;font-size:10px;
                 color:#141414;letter-spacing:2px;font-weight:700">
      )";
    o << banner_tag;
    o << R"(
    </span>
  </td>
</tr>)";
    return o.str();
}

static std::string email_footer() {
    return R"(
<tr>
  <td style="background:#0d0d0d;border-left:1px solid #1a1a1a;
             border-right:1px solid #1a1a1a;border-bottom:1px solid #1a1a1a;
             padding:20px 32px;text-align:center">
    <p style="margin:0;font-family:'Courier New',Courier,monospace;
              font-size:10px;color:#2e2e2e;letter-spacing:1px">
      &copy; 2026 Phantom Cyber Solutions &mdash; All rights reserved.
    </p>
    <p style="margin:6px 0 0;font-family:'Courier New',Courier,monospace;
              font-size:10px;color:#222;letter-spacing:1px">
      // Stay vigilant.
    </p>
  </td>
</tr>
</table>
</td></tr>
</table>
</body>
</html>)";
}

static std::string field_row(const std::string& label, const std::string& value) {
    std::ostringstream o;
    o << "<tr><td style=\"padding:7px 0;border-bottom:1px solid #1e1e1e\">"
      << "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr>"
      << "<td width=\"130\" style=\"font-family:'Courier New',Courier,monospace;"
      << "font-size:10px;color:#E2E800;letter-spacing:1px;text-transform:uppercase;"
      << "vertical-align:top;padding-right:12px\">"
      << he(label) << "</td>"
      << "<td style=\"font-family:'Courier New',Courier,monospace;font-size:13px;"
      << "color:#D6D6D6;vertical-align:top;word-break:break-word\">"
      << he(value) << "</td>"
      << "</tr></table></td></tr>";
    return o.str();
}

// ── Template: admin notification ──────────────────────────────────────────────

static std::string make_admin_html(const json& s) {
    std::string name    = s.value("name",      "Unknown");
    std::string email   = s.value("email",     "");
    std::string service = s.value("service",   "Not specified");
    std::string budget  = s.value("budget",    "Not specified");
    std::string message = s.value("message",   "");
    std::string ts      = s.value("timestamp", "");

    std::ostringstream o;
    o << email_header("// NEW CONTACT SUBMISSION RECEIVED");
    o << R"(
<tr>
  <td style="background:#141414;border-left:1px solid #1e1e1e;
             border-right:1px solid #1e1e1e;padding:24px 32px">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">)";
    o << field_row("Name",    name);
    o << field_row("Email",   email);
    o << field_row("Service", service);
    o << field_row("Budget",  budget);
    o << field_row("Sent",    ts);
    o << R"(<tr><td style="padding-top:18px">
      <div style="font-family:'Courier New',Courier,monospace;font-size:10px;
                  color:#E2E800;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">
        Message
      </div>
      <div style="background:#0d0d0d;border:1px solid #1e1e1e;
                  border-left:2px solid #E2E800;padding:14px 16px;
                  font-family:'Courier New',Courier,monospace;font-size:13px;
                  color:#D6D6D6;line-height:1.65;white-space:pre-wrap">)"
      << he(message)
      << R"(</div>
    </td></tr>
    </table>
  </td>
</tr>
<tr>
  <td style="background:#141414;border-left:1px solid #1e1e1e;
             border-right:1px solid #1e1e1e;padding:16px 32px 24px">
    <a href="mailto:)" << he(email) << R"("
      style="display:inline-block;background:#E2E800;color:#141414;
             font-family:'Courier New',Courier,monospace;font-size:11px;
             font-weight:700;letter-spacing:2px;text-transform:uppercase;
             text-decoration:none;padding:10px 20px">
      REPLY TO )" << he(name) << R"( &rarr;
    </a>
  </td>
</tr>)";
    o << email_footer();
    return o.str();
}

// ── Template: client auto-reply ───────────────────────────────────────────────

static std::string make_client_html(const std::string& name, const std::string& service) {
    std::ostringstream o;
    o << email_header("// TRANSMISSION ACKNOWLEDGED");
    o << R"(
<tr>
  <td style="background:#141414;border-left:1px solid #1e1e1e;
             border-right:1px solid #1e1e1e;padding:32px">

    <p style="margin:0 0 6px;font-family:'Courier New',Courier,monospace;
              font-size:10px;color:#E2E800;letter-spacing:2px;opacity:.55">
      &gt; SYSTEM OUTPUT
    </p>
    <p class="g"
      style="margin:0 0 22px;font-family:'Courier New',Courier,monospace;
             font-size:24px;font-weight:700;color:#E2E800;letter-spacing:1px">
      Message received.
    </p>

    <p style="margin:0 0 20px;font-family:'Courier New',Courier,monospace;
              font-size:13px;color:#D6D6D6;line-height:1.7">
      )" << he(name) << R"(, your message has been logged and is in the queue.
      Expect a response within
      <span style="color:#E2E800;font-weight:700">24 hours</span>.
    </p>

    <div style="background:#0d0d0d;border:1px solid #1e1e1e;
                border-left:2px solid #E2E800;padding:14px 16px;margin-bottom:24px">
      <p style="margin:0 0 5px;font-family:'Courier New',Courier,monospace;
                font-size:10px;color:#444;letter-spacing:1px">
        // inquiry logged
      </p>
      <p style="margin:0;font-family:'Courier New',Courier,monospace;
                font-size:12px;color:#D6D6D6">
        <span style="color:#E2E800">service:</span> )" << he(service) << R"(
      </p>
    </div>

    <p style="margin:0 0 12px;font-family:'Courier New',Courier,monospace;
              font-size:11px;color:#979797;letter-spacing:.5px">
      While you wait, explore what Phantom Cyber can do:
    </p>
    <table cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="padding-right:10px">
        <a href="https://phantomcybersolutions.com/services.html"
          style="display:inline-block;background:#E2E800;color:#141414;
                 font-family:'Courier New',Courier,monospace;font-size:10px;
                 font-weight:700;letter-spacing:1px;text-transform:uppercase;
                 text-decoration:none;padding:9px 16px">
          Services &rarr;
        </a>
      </td>
      <td>
        <a href="https://phantomcybersolutions.com/products.html"
          style="display:inline-block;border:1px solid #333;color:#979797;
                 font-family:'Courier New',Courier,monospace;font-size:10px;
                 letter-spacing:1px;text-transform:uppercase;
                 text-decoration:none;padding:9px 16px">
          Add-Ons
        </a>
      </td>
    </tr>
    </table>

  </td>
</tr>)";
    o << email_footer();
    return o.str();
}

// ── Plain-text versions ───────────────────────────────────────────────────────

static std::string make_admin_text(const json& s) {
    std::ostringstream o;
    o << "PHANTOM CYBER SOLUTIONS // NEW CONTACT\n"
      << "========================================\n\n"
      << "Name:    " << s.value("name",      "Unknown")       << "\n"
      << "Email:   " << s.value("email",     "")              << "\n"
      << "Service: " << s.value("service",   "Not specified") << "\n"
      << "Budget:  " << s.value("budget",    "Not specified") << "\n"
      << "Sent:    " << s.value("timestamp", "")              << "\n\n"
      << "Message:\n" << s.value("message", "") << "\n\n"
      << "---\nPhantom Cyber Solutions // Stay vigilant.\n";
    return o.str();
}

static std::string make_client_text(const std::string& name, const std::string& service) {
    std::ostringstream o;
    o << "PHANTOM CYBER SOLUTIONS // MESSAGE RECEIVED\n"
      << "============================================\n\n"
      << "> " << name << ", your message has been logged.\n\n"
      << "Service interest: " << service << "\n\n"
      << "Expect a response within 24 hours.\n\n"
      << "In the meantime:\n"
      << "  Services: https://phantomcybersolutions.com/services.html\n"
      << "  Add-Ons:  https://phantomcybersolutions.com/products.html\n\n"
      << "---\nPhantom Cyber Solutions // Stay vigilant.\n";
    return o.str();
}

// ── Public API ────────────────────────────────────────────────────────────────

inline bool send_contact_notification(const SmtpConfig& cfg, const json& sub) {
    std::string name = sub.value("name",    "Unknown");
    std::string svc  = sub.value("service", "General Inquiry");
    return smtp_send(cfg, cfg.admin_email,
        "[PHANTOM] New Contact: " + name + " \xe2\x80\x94 " + svc,
        make_admin_text(sub),
        make_admin_html(sub));
}

inline bool send_contact_reply(const SmtpConfig& cfg, const json& sub) {
    std::string name  = sub.value("name",    "");
    std::string email = sub.value("email",   "");
    std::string svc   = sub.value("service", "General Inquiry");
    if (email.empty()) return false;
    return smtp_send(cfg, email,
        "> Message received // Phantom Cyber Solutions",
        make_client_text(name, svc),
        make_client_html(name, svc));
}
