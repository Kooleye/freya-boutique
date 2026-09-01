"use strict";
/* =========================================================================
   Конфигурация сервера. Всё берётся из переменных окружения (.env).
   Файл .env читается вручную — чтобы не тащить зависимость dotenv.
   ========================================================================= */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

function loadEnvFile(file) {
	let raw;
	try {
		raw = fs.readFileSync(file, "utf8");
	} catch (err) {
		return;
	}
	raw.split(/\r?\n/).forEach((line) => {
		const text = line.trim();
		if (!text || text.startsWith("#")) return;
		const at = text.indexOf("=");
		if (at < 0) return;
		const key = text.slice(0, at).trim();
		let value = text.slice(at + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		if (process.env[key] === undefined) process.env[key] = value;
	});
}

loadEnvFile(process.env.FREYA_ENV_FILE || path.join(ROOT, ".env"));

function str(name, fallback) {
	const value = process.env[name];
	return value === undefined || value === "" ? fallback : String(value);
}

function num(name, fallback) {
	const value = Number(process.env[name]);
	return Number.isFinite(value) ? value : fallback;
}

function bool(name, fallback) {
	const value = process.env[name];
	if (value === undefined || value === "") return fallback;
	return /^(1|true|yes|on)$/i.test(String(value));
}

const dataDir = path.resolve(str("DATA_DIR", path.join(ROOT, "data")));

const config = {
	root: ROOT,
	publicDir: path.resolve(str("PUBLIC_DIR", path.join(ROOT, "public"))),

	// Данные каталога и бэкапы — вне папки с кодом, деплой их не трогает
	dataDir,
	catalogFile: path.join(dataDir, "catalog.json"),
	ordersFile: path.join(dataDir, "orders.json"),
	backupsDir: path.join(dataDir, "backups"),
	adminFile: path.join(dataDir, "admin.json"),
	localMediaDir: path.join(dataDir, "media"),
	tmpDir: path.join(dataDir, "tmp"),
	backupsKeep: num("BACKUPS_KEEP", 60),

	port: num("PORT", 3000),
	host: str("HOST", "127.0.0.1"),
	trustProxy: bool("TRUST_PROXY", true),
	httpsCookies: bool("HTTPS_COOKIES", false),

	// Хранилище медиа: s3 (Timeweb S3) или local (диск сервера)
	storageDriver: str("STORAGE_DRIVER", "s3").toLowerCase(),
	s3: {
		endpoint: str("S3_ENDPOINT", "https://s3.twcstorage.ru"),
		region: str("S3_REGION", "ru-1"),
		bucket: str("S3_BUCKET", ""),
		accessKey: str("S3_ACCESS_KEY", ""),
		secretKey: str("S3_SECRET_KEY", ""),
		acl: str("S3_ACL", "public-read"),
		forcePathStyle: bool("S3_PATH_STYLE", true),
	},

	// Публичный адрес медиа: CDN или прямой адрес бакета.
	// Пусто => отдаём через /media (только для локального драйвера).
	mediaBase: str("MEDIA_BASE_URL", "").replace(/\/+$/, ""),

	admin: {
		password: str("ADMIN_PASSWORD", ""),
		passwordHash: str("ADMIN_PASSWORD_HASH", ""),
		sessionSecret: str("SESSION_SECRET", ""),
		sessionHours: num("SESSION_HOURS", 12),
		loginAttempts: num("LOGIN_ATTEMPTS", 10),
		loginWindowMin: num("LOGIN_WINDOW_MIN", 15),
	},

	video: {
		maxSeconds: num("VIDEO_MAX_SECONDS", 20),
		fps: num("VIDEO_FPS", 30),
		shortSide: num("VIDEO_SHORT_SIDE", 1080),
		longSide: num("VIDEO_LONG_SIDE", 1920),
		upscale: bool("VIDEO_UPSCALE", true),
		crf: num("VIDEO_CRF", 23),
		maxrateK: num("VIDEO_MAXRATE_K", 4500),
		audioK: num("VIDEO_AUDIO_K", 128),
		preset: str("VIDEO_PRESET", "veryfast"),
	},

	photo: {
		mainSide: num("PHOTO_MAIN_SIDE", 1400),
		thumbSide: num("PHOTO_THUMB_SIDE", 500),
		mainQuality: num("PHOTO_MAIN_QUALITY", 80),
		thumbQuality: num("PHOTO_THUMB_QUALITY", 72),
	},

	limits: {
		uploadPhotoMb: num("UPLOAD_PHOTO_MB", 40),
		uploadVideoMb: num("UPLOAD_VIDEO_MB", 400),
		catalogMb: num("CATALOG_MB", 12),
	},

	ffmpeg: str("FFMPEG_PATH", "ffmpeg"),
	ffprobe: str("FFPROBE_PATH", "ffprobe"),
};

module.exports = config;
