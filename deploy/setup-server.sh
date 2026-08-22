#!/usr/bin/env bash
# =========================================================================
#  Первичная настройка чистого VPS на Timeweb Cloud (Ubuntu 22.04/24.04).
#
#  Запуск от root:
#     bash deploy/setup-server.sh
#
#  Ставит Node 20, ffmpeg, nginx, certbot, создаёт пользователя freya
#  и раскладку папок /srv/freya.
# =========================================================================
set -euo pipefail

SITE_DIR=/srv/freya
SITE_USER=freya

if [ "$(id -u)" != "0" ]; then
  echo "Запустите от root: sudo bash deploy/setup-server.sh"
  exit 1
fi

echo "==> Обновляю систему"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

echo "==> Ставлю базовые пакеты"
apt-get install -y curl ca-certificates gnupg git ufw nginx ffmpeg

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "==> Ставлю Node.js 20 LTS"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Node: $(node -v)"
echo "==> ffmpeg: $(ffmpeg -version | head -1)"

echo "==> Создаю пользователя и папки"
id -u "$SITE_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$SITE_USER"
mkdir -p "$SITE_DIR/releases" "$SITE_DIR/data/backups" "$SITE_DIR/data/media" "$SITE_DIR/data/tmp" "$SITE_DIR/data/daily"
chown -R "$SITE_USER:$SITE_USER" "$SITE_DIR"
chmod 750 "$SITE_DIR/data"

if [ ! -f "$SITE_DIR/.env" ]; then
  echo "==> Создаю пустой $SITE_DIR/.env — его надо заполнить"
  touch "$SITE_DIR/.env"
  chown "$SITE_USER:$SITE_USER" "$SITE_DIR/.env"
  chmod 600 "$SITE_DIR/.env"
fi

echo "==> Настраиваю фаервол"
ufw allow OpenSSH || true
ufw allow "Nginx Full" || true
ufw --force enable || true

echo "==> Ставлю certbot (бесплатные SSL-сертификаты)"
apt-get install -y certbot python3-certbot-nginx

cat <<'TXT'

Готово. Дальше по порядку:

  1) Заполните /srv/freya/.env (возьмите за основу .env.example):
     ADMIN_PASSWORD, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, MEDIA_BASE_URL
  2) Выложите код:  bash deploy/deploy.sh
  3) Положите nginx-конфиг:
     cp deploy/nginx.conf /etc/nginx/sites-available/freya
     ln -sf /etc/nginx/sites-available/freya /etc/nginx/sites-enabled/freya
     rm -f /etc/nginx/sites-enabled/default
     nginx -t && systemctl reload nginx
  4) Выпишите сертификат:
     certbot --nginx -d ваш-домен.ru -d www.ваш-домен.ru

TXT
