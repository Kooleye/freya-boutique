"use strict";
/* =========================================================================
   Вход в админку.

   Пароль больше не лежит в коде сайта: проверка только на сервере,
   хранится scrypt-хеш. Сессия — подписанная HttpOnly-cookie.
   ========================================================================= */

const crypto = require("crypto");
const fsp = require("fs/promises");

const config = require("./config");

const COOKIE = "freya_admin";
const attempts = new Map();

function scryptHash(password, salt) {
	return new Promise((resolve, reject) => {
		crypto.scrypt(String(password), salt, 32, { N: 16384, r: 8, p: 1 }, (err, key) => {
			if (err) reject(err);
			else resolve(key.toString("hex"));
		});
	});
}

async function makeHash(password) {
	const salt = crypto.randomBytes(16).toString("hex");
	const hash = await scryptHash(password, salt);
	return "scrypt$" + salt + "$" + hash;
}

async function verifyHash(password, stored) {
	const parts = String(stored || "").split("$");
	if (parts.length !== 3 || parts[0] !== "scrypt") return false;
	const actual = await scryptHash(password, parts[1]);
	const a = Buffer.from(actual, "hex");
	const b = Buffer.from(parts[2], "hex");
	if (a.length !== b.length) return false;
	return crypto.timingSafeEqual(a, b);
}

/* --------------------------- Где живёт пароль ---------------------------
   1) DATA_DIR/admin.json — пароль, сменённый через админку
   2) ADMIN_PASSWORD_HASH из .env
   3) ADMIN_PASSWORD из .env (хешируется на лету)
   -------------------------------------------------------------------------- */

async function readAdminFile() {
	try {
		const raw = await fsp.readFile(config.adminFile, "utf8");
		const data = JSON.parse(raw);
		return data && typeof data === "object" ? data : null;
	} catch (err) {
		return null;
	}
}

async function writeAdminFile(data) {
	await fsp.mkdir(config.dataDir, { recursive: true });
	await fsp.writeFile(config.adminFile, JSON.stringify(data, null, 2), "utf8");
}

async function currentHash() {
	const file = await readAdminFile();
	if (file && file.passwordHash) return file.passwordHash;
	if (config.admin.passwordHash) return config.admin.passwordHash;
	if (config.admin.password) return makeHash(config.admin.password);
	return null;
}

async function checkPassword(password) {
	const stored = await currentHash();
	if (!stored) return false;
	return verifyHash(password, stored);
}

async function changePassword(current, next) {
	if (!(await checkPassword(current))) return { ok: false, error: "Старый пароль не подходит" };
	const value = String(next || "").trim();
	if (value.length < 6) return { ok: false, error: "Новый пароль короче 6 символов" };
	const hash = await makeHash(value);
	const file = (await readAdminFile()) || {};
	file.passwordHash = hash;
	file.updatedAt = new Date().toISOString();
	await writeAdminFile(file);
	return { ok: true };
}

/* ------------------------------ Сессия ------------------------------ */

let secretCache = "";
async function secret() {
	if (secretCache) return secretCache;
	if (config.admin.sessionSecret) {
		secretCache = config.admin.sessionSecret;
		return secretCache;
	}
	// секрет не задан — генерируем и запоминаем в DATA_DIR (сессии живут между рестартами)
	const file = (await readAdminFile()) || {};
	if (file.sessionSecret) {
		secretCache = file.sessionSecret;
		return secretCache;
	}
	file.sessionSecret = crypto.randomBytes(32).toString("hex");
	await writeAdminFile(file);
	secretCache = file.sessionSecret;
	return secretCache;
}

async function makeToken() {
	const payload = Buffer.from(
		JSON.stringify({
			exp: Date.now() + config.admin.sessionHours * 3600 * 1000,
			id: crypto.randomBytes(8).toString("hex"),
		}),
		"utf8",
	).toString("base64url");
	const sig = crypto
		.createHmac("sha256", await secret())
		.update(payload)
		.digest("base64url");
	return payload + "." + sig;
}

async function readToken(token) {
	const parts = String(token || "").split(".");
	if (parts.length !== 2) return null;
	const expected = crypto
		.createHmac("sha256", await secret())
		.update(parts[0])
		.digest("base64url");
	const a = Buffer.from(parts[1]);
	const b = Buffer.from(expected);
	if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
	try {
		const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
		if (!payload || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
		return payload;
	} catch (err) {
		return null;
	}
}

function parseCookies(header) {
	const out = {};
	String(header || "")
		.split(";")
		.forEach((part) => {
			const at = part.indexOf("=");
			if (at < 0) return;
			out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
		});
	return out;
}

async function isAuthorized(req) {
	const cookies = parseCookies(req.headers.cookie);
	const payload = await readToken(cookies[COOKIE]);
	return !!payload;
}

function cookieHeader(token, maxAgeSeconds) {
	const parts = [
		COOKIE + "=" + (token || ""),
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
		"Max-Age=" + (maxAgeSeconds === undefined ? config.admin.sessionHours * 3600 : maxAgeSeconds),
	];
	if (config.httpsCookies) parts.push("Secure");
	return parts.join("; ");
}

/* --------------------------- Защита от перебора --------------------------- */

function rateKey(req) {
	if (config.trustProxy) {
		const forwarded = req.headers["x-forwarded-for"];
		if (forwarded) return String(forwarded).split(",")[0].trim();
	}
	return (req.socket && req.socket.remoteAddress) || "unknown";
}

function tooManyAttempts(req) {
	const key = rateKey(req);
	const windowMs = config.admin.loginWindowMin * 60 * 1000;
	const entry = attempts.get(key);
	if (!entry) return false;
	if (Date.now() - entry.since > windowMs) {
		attempts.delete(key);
		return false;
	}
	return entry.count >= config.admin.loginAttempts;
}

function registerFailure(req) {
	const key = rateKey(req);
	const entry = attempts.get(key);
	if (!entry || Date.now() - entry.since > config.admin.loginWindowMin * 60 * 1000) {
		attempts.set(key, { count: 1, since: Date.now() });
		return;
	}
	entry.count++;
}

function resetFailures(req) {
	attempts.delete(rateKey(req));
}

async function hasPassword() {
	return !!(await currentHash());
}

module.exports = {
	COOKIE,
	makeHash,
	checkPassword,
	changePassword,
	makeToken,
	isAuthorized,
	cookieHeader,
	parseCookies,
	tooManyAttempts,
	registerFailure,
	resetFailures,
	hasPassword,
	rateKey,
};
