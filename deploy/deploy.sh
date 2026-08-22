#!/usr/bin/env bash
# =========================================================================
#  Выкладка новой версии сайта без риска для каталога товаров.
#
#  Идея: код ложится в новую папку releases/<дата>, а симлинк current
#  переводится на неё одной командой. Каталог и медиа лежат в
#  /srv/freya/data — выкладка их вообще не трогает.
#
#  Запуск на сервере из папки с кодом (от root):
#     bash deploy/deploy.sh
#
#  Откат на предыдущую версию:
#     bash deploy/deploy.sh --rollback
# =========================================================================
set -euo pipefail

SITE_DIR=/srv/freya
SITE_USER=freya
RELEASES="$SITE_DIR/releases"
KEEP=5

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$(id -u)" != "0" ]; then
  echo "Запустите от root: sudo bash deploy/deploy.sh"
  exit 1
fi

# ------------------------------- Откат -------------------------------
if [ "${1:-}" = "--rollback" ]; then
  PREV="$(ls -1 "$RELEASES" | sort | tail -2 | head -1)"
  CUR="$(basename "$(readlink -f "$SITE_DIR/current")")"
  if [ -z "$PREV" ] || [ "$PREV" = "$CUR" ]; then
    echo "Откатываться некуда: предыдущего релиза нет"
    exit 1
  fi
  ln -sfn "$RELEASES/$PREV" "$SITE_DIR/current"
  systemctl restart freya
  echo "Откатились на релиз $PREV"
  exit 0
fi

# --------------------- Проверки перед выкладкой ---------------------
command -v node >/dev/null || { echo "Нет Node.js — сначала bash deploy/setup-server.sh"; exit 1; }
command -v ffmpeg >/dev/null || { echo "Нет ffmpeg — apt-get install -y ffmpeg"; exit 1; }
[ -f "$SITE_DIR/.env" ] || { echo "Нет $SITE_DIR/.env — скопируйте .env.example и заполните"; exit 1; }

echo "==> Проверяю синтаксис кода"
( cd "$SRC" && node --check server/server.js )

STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$RELEASES/$STAMP"

echo "==> Копирую код в $TARGET"
mkdir -p "$TARGET"
tar -C "$SRC" \
  --exclude="./.git" \
  --exclude="./data" \
  --exclude="./node_modules" \
  --exclude="./.env" \
  -cf - . | tar -C "$TARGET" -xf -

# .env живёт рядом с данными, а не внутри релиза
ln -sfn "$SITE_DIR/.env" "$TARGET/.env"

mkdir -p "$SITE_DIR/data/backups" "$SITE_DIR/data/media" "$SITE_DIR/data/tmp"
chown -R "$SITE_USER:$SITE_USER" "$TARGET" "$SITE_DIR/data"
chmod +x "$TARGET/deploy/"*.sh || true

echo "==> Переключаю current"
ln -sfn "$TARGET" "$SITE_DIR/current"

if [ ! -f /etc/systemd/system/freya.service ]; then
  echo "==> Ставлю systemd-юнит"
  cp "$TARGET/deploy/freya.service" /etc/systemd/system/freya.service
  systemctl daemon-reload
  systemctl enable freya
fi

echo "==> Перезапускаю сервис"
systemctl restart freya
sleep 2

if ! systemctl is-active --quiet freya; then
  echo "Сервис не поднялся. Логи:"
  journalctl -u freya -n 40 --no-pager
  exit 1
fi

PORT="$(grep -E '^PORT=' "$SITE_DIR/.env" | tail -1 | cut -d= -f2 || true)"
PORT="${PORT:-3000}"
if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null; then
  echo "==> Сервер отвечает на порту $PORT"
else
  echo "Сервер не ответил на /api/health — смотрите journalctl -u freya -f"
  exit 1
fi

echo "==> Чистю старые релизы (оставляю $KEEP)"
cd "$RELEASES"
ls -1 | sort | head -n "-$KEEP" | xargs -r rm -rf

echo ""
echo "Готово: выложен релиз $STAMP"
echo "Каталог товаров не трогали: $SITE_DIR/data/catalog.json"
