# Backend (LMS-BE) — Deploy to EC2 with Docker

Node/Express + Socket.IO + Puppeteer. Runs in Docker on an EC2 instance, behind
nginx (TLS termination + WebSocket proxy). MongoDB is on Atlas. Pipeline:
[.github/workflows/deploy.yml](.github/workflows/deploy.yml).

## How it works
On push to `main`: build/syntax-check → SSH to EC2 → `git pull` → `docker compose up -d --build`.

```
Internet :443 ─▶ nginx (TLS) ─▶ backend:5000 (Node)  ─▶ MongoDB Atlas
                  • /api/*        proxied                ─▶ AWS S3
                  • /socket.io/   WebSocket upgrade
```

---

## 1. Launch EC2
- Ubuntu 22.04+, t3.small or larger (Puppeteer/Chromium needs RAM).
- Security group inbound: **22** (SSH), **80**, **443**.
- Point DNS `api.yourdomain.com` → instance public IP (A record).

## 2. Install Docker + clone
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

cd ~ && git clone https://github.com/<you>/lms-backend.git app
cd app
cp .env.example .env && nano .env      # MONGO_URI, JWT_SECRET, Google, AWS keys
```

## 3. Get the TLS certificate (one-time, before first start)
Edit `deploy/nginx/api.conf` and replace `api.yourdomain.com` with your domain.
Nothing is on port 80 yet, so use standalone mode:
```bash
sudo apt-get install -y certbot
sudo certbot certonly --standalone -d api.yourdomain.com
```
Certs land in `/etc/letsencrypt/` (mounted read-only into the nginx container).

## 4. Start
```bash
mkdir -p deploy/certbot/www
docker compose up -d --build
docker compose logs -f backend
```
API is live at `https://api.yourdomain.com`. This is the value the frontend's
`VITE_API_URL` / `VITE_SOCKET_URL` must point to.

### Cert renewal
```bash
# add to crontab -e
0 3 * * * certbot renew --quiet --pre-hook "docker compose -f /home/ubuntu/app/docker-compose.yml stop nginx" --post-hook "docker compose -f /home/ubuntu/app/docker-compose.yml start nginx"
```

---

## 5. GitHub repo configuration (for CI deploy)
**Settings → Secrets and variables → Actions**

Secrets:
| Name | Value |
|---|---|
| `EC2_HOST` | instance public IP / DNS |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_KEY` | the **private** key (PEM) for SSH |

Variables:
| Name | Example |
|---|---|
| `APP_DIR` | `/home/ubuntu/app` |

## 6. Push to deploy
```bash
cd LMS-BE
git init && git add . && git commit -m "Initial backend"
git branch -M main
git remote add origin https://github.com/<you>/lms-backend.git
git push -u origin main
```

## Notes
- All `puppeteer.launch` calls already pass `--no-sandbox`; the Dockerfile installs the Chromium system libraries.
- S3 bucket `bluverse-lms` / region `ap-southeast-2` are hardcoded in source — only the AWS keys come from `.env`.
- `.env` lives only on the server (git-ignored); it is never committed.
- Single instance. Scaling Socket.IO across replicas later needs a Redis adapter + sticky sessions at the load balancer.
