#!/usr/bin/env bash
# =========================================================================
#  Суточная резервная копия каталога, заказов и настроек администратора.
#
#  Сервер и без того делает копию при каждой правке (data/backups),
#  но этот скрипт складывает ещё и суточные архивы.
#
#  Раз в сутки в 3:30 (crontab -e):
#     30 3 * * * /srv/freya/current/deploy/backup.sh >> /var/log/freya-backup.log 2>&1
# =========================================================================
set -euo pipefail

SITE_DIR=/srv/freya
DATA="$SITE_DIR/data"
OUT="$DATA/daily"
KEEP_DAYS=30

mkdir -p "$OUT"

if [ ! -f "$DATA/catalog.json" ]; then
  echo "[$(date)] каталога нет — нечего сохранять"
  exit 0
fi

STAMP="$(date +%Y-%m-%d)"
ARCHIVE="$OUT/catalog-$STAMP.tar.gz"

FILES="catalog.json"
[ -f "$DATA/admin.json" ] && FILES="$FILES admin.json"
[ -f "$DATA/orders.json" ] && FILES="$FILES orders.json"

tar -C "$DATA" -czf "$ARCHIVE" $FILES
echo "[$(date)] копия: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

# Старые суточные архивы чистим
find "$OUT" -name 'catalog-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

# --------------- Копия в хранилище (если есть aws cli) ---------------
# Чтобы включить:
#   apt-get install -y awscli
#   aws configure set aws_access_key_id     <S3_ACCESS_KEY>
#   aws configure set aws_secret_access_key <S3_SECRET_KEY>
#   export BACKUP_BUCKET=<имя-бакета>   (лучше отдельный, приватный)
BACKUP_BUCKET="${BACKUP_BUCKET:-}"
S3_ENDPOINT="${S3_ENDPOINT:-https://s3.twcstorage.ru}"

if [ -n "$BACKUP_BUCKET" ] && command -v aws >/dev/null 2>&1; then
  aws --endpoint-url "$S3_ENDPOINT" s3 cp "$ARCHIVE" "s3://$BACKUP_BUCKET/backups/" \
    && echo "[$(date)] копия уехала в s3://$BACKUP_BUCKET/backups/"
fi
