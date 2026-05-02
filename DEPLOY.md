# Deployment Guide

How to run this on a self-hosted Linux server (tested on Arch Linux, Raspberry Pi 5) with a Cloudflare Tunnel for public HTTPS access.

## Prerequisites

- Server running any modern Linux distro
- Domain name with DNS managed in Cloudflare
- `cloudflared` installed (see below)
- `systemd` with user services enabled (`loginctl enable-linger <your-user>`)

## 1. Build and Configure

Follow the [README setup steps](README.md#setup) first. Make sure `data/config.json` is in place with your values and the server builds successfully.

## 2. Systemd Service

Create `~/.config/systemd/user/your-server.service`:

```ini
[Unit]
Description=CyberSec web server
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/CyberSec-Web-Services/backend/build
ExecStart=/path/to/CyberSec-Web-Services/backend/build/phantom-server
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Enable and start:
```bash
systemctl --user daemon-reload
systemctl --user enable --now your-server.service
systemctl --user status your-server.service
```

## 3. Cloudflare Tunnel

Install `cloudflared`:
```bash
# Arch Linux
yay -S cloudflared
# or download the binary directly from https://github.com/cloudflare/cloudflared/releases

# Debian / Ubuntu
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 \
  -o ~/.local/bin/cloudflared && chmod +x ~/.local/bin/cloudflared
```

Authenticate and create a tunnel:
```bash
cloudflared tunnel login
cloudflared tunnel create your-tunnel-name
```

Create `~/.cloudflared/config.yml`:
```yaml
tunnel: <your-tunnel-id>
credentials-file: /home/<user>/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: yourdomain.com
    service: http://localhost:<port>
  - hostname: www.yourdomain.com
    service: http://localhost:<port>
  - service: http_status:404
```

Add DNS records in Cloudflare dashboard:
- `@` → CNAME → `<tunnel-id>.cfargotunnel.com`
- `www` → CNAME → `<tunnel-id>.cfargotunnel.com`

Create the tunnel systemd service at `~/.config/systemd/user/your-tunnel.service`:

```ini
[Unit]
Description=Cloudflare Tunnel
After=network.target your-server.service
Requires=your-server.service

[Service]
Type=simple
ExecStart=/home/<user>/.local/bin/cloudflared tunnel --config /home/<user>/.cloudflared/config.yml run
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Enable:
```bash
systemctl --user enable --now your-tunnel.service
```

## 4. Arch Linux DNS Quirk

If `cloudflared` uses Go's built-in DNS resolver and you have a custom DNS setup (e.g. Tailscale), the resolver may fail to reach Cloudflare edge servers. Workaround — wrap the binary with a mount namespace that overrides `/etc/resolv.conf`:

```bash
cat > ~/.local/bin/cloudflared-wrap << 'EOF'
#!/bin/bash
exec unshare --mount --map-root-user -- bash -c '
  mount --bind <(echo "nameserver 1.1.1.1") /etc/resolv.conf
  exec /home/<user>/.local/bin/cloudflared "$@"
' -- "$@"
EOF
chmod +x ~/.local/bin/cloudflared-wrap
```

Then use `cloudflared-wrap` in the ExecStart line of your tunnel service.

## 5. Verify

```bash
# Server logs
journalctl --user -u your-server.service -f

# Tunnel logs
journalctl --user -u your-tunnel.service -f

# Test locally
curl http://localhost:<port>/api/services

# Test through tunnel
curl https://yourdomain.com/api/services
```

## 6. Stripe Webhook

Register your webhook in the [Stripe dashboard](https://dashboard.stripe.com/webhooks):

1. **Developers → Webhooks → Add endpoint**
2. URL: `https://yourdomain.com/api/stripe/webhook`
3. Events to select (minimum):
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
4. Copy the signing secret (`whsec_...`) → add to `data/config.json` as `stripe.webhook_secret` → rebuild and restart

**Test a webhook:**
- In the Stripe dashboard, open your endpoint → **Send test webhook** → select `checkout.session.completed`
- Check `data/payments.json` on the server for the logged event

## 7. Updating

```bash
git pull
cd backend/build
cmake .. && make -j$(nproc)
systemctl --user restart your-server.service
```

The post-build step in CMakeLists.txt automatically copies updated `data/` and `frontend/public/` into the build directory.
