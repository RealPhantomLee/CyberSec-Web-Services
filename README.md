# CyberSec Web Services

A self-hosted business website for cybersecurity and web development services. Built with a C++ backend, plain HTML/CSS/JS frontend, and designed to run on a Raspberry Pi (or any Linux server) behind a Cloudflare Tunnel.

## Features

- **Service catalog** — JSON-driven services and product add-ons, loaded dynamically
- **Blog** — Admin-only posting with publish/draft toggle
- **Contact form** — Rate-limited submissions with themed HTML email notifications (admin alert + client auto-reply) via libcurl SMTP
- **Stripe Checkout** — Backend creates hosted checkout sessions; frontend redirects to Stripe
- **Stripe Webhook** — HMAC-SHA256 signature verification, events logged to `data/payments.json`
- **Admin dashboard** — Session-based auth, analytics, contact management, blog management; served from an obscured URL
- **Security hardening** — Random hex session tokens, 90s TTL, per-IP rate limiting (login: 5/15min, contact: 3/hr), Cloudflare header awareness

## Tech Stack

| Layer | Library / Tool |
|---|---|
| HTTP server | [cpp-httplib](https://github.com/yhirose/cpp-httplib) v0.16.3 (header-only) |
| JSON | [nlohmann/json](https://github.com/nlohmann/json) v3.11.3 (header-only) |
| Crypto | OpenSSL (SHA-256 sessions, HMAC-SHA256 webhook verification) |
| HTTP client | libcurl (Stripe API calls, SMTP email) |
| Build | CMake 3.14+ with FetchContent (fetches deps at configure time) |
| Frontend | Vanilla HTML5 / CSS3 / JavaScript |
| Hosting | Raspberry Pi 5 / any Linux, Cloudflare Tunnel |

## Project Structure

```
CyberSec-Web-Services/
├── backend/
│   ├── src/
│   │   ├── main.cpp          — C++ server, all routes
│   │   └── email.hpp         — SMTP + HTML email templates
│   └── CMakeLists.txt
├── frontend/
│   └── public/               — static files served by the backend
│       ├── css/
│       ├── js/
│       ├── img/
│       ├── fonts/
│       └── *.html
├── data/
│   ├── config.example.json   — copy to config.json and fill in values
│   ├── services.json         — service catalog
│   ├── products.json         — add-on products
│   └── blog.json             — blog posts
└── scripts/
    ├── build.sh              — cross-distro build helper
    └── start.sh              — launch the compiled binary
```

## Setup

### 1. Prerequisites

**Debian / Ubuntu:**
```bash
sudo apt install -y g++ cmake libssl-dev libcurl4-openssl-dev git
```

**Arch Linux:**
```bash
sudo pacman -S gcc cmake openssl curl git
```

### 2. Configuration

```bash
cp data/config.example.json data/config.json
```

Edit `data/config.json`:
- `site.port` — port the server listens on
- `admin.username` / `admin.password_hash` — SHA-256 hash of your chosen password
- `stripe.*` — keys from your Stripe dashboard
- `smtp.*` — Gmail app password (set `enabled: true` to activate)

Generate a password hash:
```bash
echo -n 'yourpassword' | sha256sum | awk '{print $1}'
```

### 3. Build

```bash
scripts/build.sh
# or manually:
mkdir -p backend/build && cd backend/build
cmake .. -DCMAKE_BUILD_TYPE=Release
make -j$(nproc)
```

The build copies `data/` and `frontend/public/` into `backend/build/` automatically. The server must be **run from `backend/build/`** so it can find those paths at runtime.

### 4. Run

```bash
cd backend/build
./phantom-server
```

Or use the provided systemd service template (see [DEPLOY.md](DEPLOY.md)).

## API Routes

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/services` | no | Service catalog |
| GET | `/api/products` | no | Add-on products |
| GET | `/api/blog` | no | Published blog posts |
| POST | `/api/contact` | no | Contact form submission |
| POST | `/api/stripe/webhook` | no | Stripe webhook (HMAC verified) |
| POST | `/api/checkout/create-session` | no | Create Stripe Checkout session |
| POST | `/api/admin/login` | no | Issues session token |
| POST | `/api/admin/logout` | session | Invalidates session token |
| GET | `/api/admin/contacts` | session | All contact submissions |
| POST | `/api/admin/contacts/read/:id` | session | Mark submission read |
| POST | `/api/admin/blog` | session | Create blog post |
| DELETE | `/api/admin/blog/:id` | session | Delete blog post |
| GET | `/api/admin/analytics` | session | Contact stats + session check |

## Deployment

See [DEPLOY.md](DEPLOY.md) for systemd service setup and Cloudflare Tunnel configuration.

## License

MIT
