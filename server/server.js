"use strict";
/* =========================================================================
   Сервер магазина «Фрейя» для Timeweb Cloud.

   Зависимостей ноль: только встроенные модули Node и системный ffmpeg,
   поэтому на сервере нет шага npm install, который мог бы упасть.

   Что делает:
     • раздаёт сайт из public/
     • держит каталог товаров в DATA_DIR/catalog.json — вне папки с кодом
     • принимает фото/видео, жмёт их ffmpeg и кладёт в S3 Timeweb
     • видео всегда 1080p / 30 кадров / до 20 секунд
   ========================================================================= */

const fs = require("fs");
const fsp = require("fs/promises");
const http = require("http");
const path = require("path");

const config = require("./lib/config");
const storage = require("./lib/storage");
const media = require("./lib/media");
const catalog = require("./lib/catalog");
const auth = require("./lib/auth");
const orders = require("./lib/orders");

const MIME = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".ico": "image/x-icon",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".txt": "text/plain; charset=utf-8",
	".xml": "application/xml; charset=utf-8",
};

const LONG_CACHE = "public, max-age=31536000, immutable";

/* ------------------------------- Помощники ------------------------------- */

function sendJson(res, status, payload, headers) {
	const body = Buffer.from(JSON.stringify(payload), "utf8");
	res.writeHead(
		status,
		Object.assign(
			{
				"content-type": "application/json; charset=utf-8",
				"content-length": body.length,
				"cache-control": "no-store",
			},
			headers || {},
		),
	);
	res.end(body);
}

function fail(res, status, message) {
	sendJson(res, status, { ok: false, error: message });
}

function readBody(req, limitBytes) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > limitBytes) {
				reject(Object.assign(new Error("Запрос слишком большой"), { status: 413 }));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}

async function readJson(req, limitMb) {
	const raw = await readBody(req, Math.max(1, limitMb) * 1024 * 1024);
	if (!raw.length) return {};
	try {
		return JSON.parse(raw.toString("utf8"));
	} catch (err) {
		throw Object.assign(new Error("Неверный JSON в запросе"), { status: 400 });
	}
}

// Файл пишем потоком в временную папку: память не растёт на 400 МБ видео
function saveUpload(req, limitMb) {
	return new Promise((resolve, reject) => {
		const file = path.join(
			config.tmpDir,
			"upload-" + Date.now() + "-" + media.shortId() + ".bin",
		);
		const limit = limitMb * 1024 * 1024;
		let size = 0;
		let done = false;
		const out = fs.createWriteStream(file);

		const abort = (err) => {
			if (done) return;
			done = true;
			out.destroy();
			fs.unlink(file, () => reject(err));
		};

		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > limit) {
				req.destroy();
				abort(Object.assign(new Error("Файл тяжелее " + limitMb + " МБ"), { status: 413 }));
			}
		});
		req.on("error", abort);
		out.on("error", abort);
		out.on("finish", () => {
			if (done) return;
			if (!size) {
				abort(Object.assign(new Error("Пустой файл"), { status: 400 }));
				return;
			}
			done = true;
			resolve({ file, bytes: size });
		});
		req.pipe(out);
	});
}

function safeSlug(text) {
	const slug = String(text || "")
		.toLowerCase()
		.replace(/[^a-z0-9\-_]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 48);
	return slug || "common";
}

function mediaKey(productId, kind, ext) {
	return "products/" + safeSlug(productId) + "/" + kind + "-" + media.shortId() + "." + ext;
}

async function cleanTmp() {
	const hour = 60 * 60 * 1000;
	let names = [];
	try {
		names = await fsp.readdir(config.tmpDir);
	} catch (err) {
		return;
	}
	for (const name of names) {
		if (name.startsWith("catalog-")) continue;
		const file = path.join(config.tmpDir, name);
		const stat = await fsp.stat(file).catch(() => null);
		if (stat && stat.isFile() && Date.now() - stat.mtimeMs > hour) {
			await fsp.unlink(file).catch(() => {});
		}
	}
}

function safeJoin(baseDir, relPath) {
	let decoded;
	try {
		decoded = decodeURIComponent(relPath);
	} catch (err) {
		return null;
	}
	if (decoded.includes("\0")) return null;
	const target = path.normalize(path.join(baseDir, decoded));
	if (target !== baseDir && !target.startsWith(baseDir + path.sep)) return null;
	return target;
}

async function serveFile(req, res, file, cacheControl) {
	const stat = await fsp.stat(file).catch(() => null);
	if (!stat || !stat.isFile()) return false;

	const ext = path.extname(file).toLowerCase();
	const etag = '"' + stat.size.toString(36) + "-" + Math.round(stat.mtimeMs).toString(36) + '"';

	if (req.headers["if-none-match"] === etag) {
		res.writeHead(304, { etag, "cache-control": cacheControl });
		res.end();
		return true;
	}

	res.writeHead(200, {
		"content-type": MIME[ext] || "application/octet-stream",
		"content-length": stat.size,
		"cache-control": cacheControl,
		etag,
	});
	if (req.method === "HEAD") {
		res.end();
		return true;
	}
	await new Promise((resolve) => {
		const stream = fs.createReadStream(file);
		stream.on("error", () => resolve());
		stream.on("close", () => resolve());
		stream.pipe(res);
	});
	return true;
}

async function requireAdmin(req, res) {
	if (await auth.isAuthorized(req)) return true;
	fail(res, 401, "Нужен вход в панель");
	return false;
}

// Публичная форма заказа: защита от случайного или автоматического спама.
const orderAttempts = new Map();
function allowOrder(req) {
	const key = auth.rateKey(req);
	const now = Date.now();
	const windowMs = 30 * 60 * 1000;
	const entry = orderAttempts.get(key);
	if (!entry || now - entry.since > windowMs) {
		orderAttempts.set(key, { count: 1, since: now });
		return true;
	}
	if (entry.count >= 10) return false;
	entry.count++;
	return true;
}

// Проверка, что ffmpeg и ffprobe вообще есть на сервере
async function checkTools() {
	const out = { ffmpeg: false, ffprobe: false };
	try {
		await media.run(config.ffmpeg, ["-version"], 15000);
		out.ffmpeg = true;
	} catch (err) {
		out.ffmpegError = err.message;
	}
	try {
		await media.run(config.ffprobe, ["-version"], 15000);
		out.ffprobe = true;
	} catch (err) {
		out.ffprobeError = err.message;
	}
	return out;
}

/* ------------------------------- Маршруты ------------------------------- */

async function handleApi(req, res, url) {
	const route = url.pathname;
	const method = req.method;

	// Настройки для браузера: адрес медиа и лимиты загрузки
	if (route === "/api/config" && method === "GET") {
		sendJson(res, 200, {
			ok: true,
			mediaBase: storage.mediaBase(),
			storage: storage.driver,
			video: {
				maxSeconds: config.video.maxSeconds,
				fps: config.video.fps,
				shortSide: config.video.shortSide,
				longSide: config.video.longSide,
			},
			limits: {
				uploadPhotoMb: config.limits.uploadPhotoMb,
				uploadVideoMb: config.limits.uploadVideoMb,
				catalogMb: config.limits.catalogMb,
				video: {
					maxSeconds: config.video.maxSeconds,
					fps: config.video.fps,
					shortSide: config.video.shortSide,
					longSide: config.video.longSide,
				},
			},
			hasPassword: await auth.hasPassword(),
		});
		return true;
	}

	if (route === "/api/catalog" && method === "GET") {
		const data = await catalog.read();
		const info = await catalog.stats();
		sendJson(res, 200, {
			ok: true,
			mediaBase: storage.mediaBase(),
			catalog: data,
			updatedAt: (data && data.updatedAt) || info.updatedAt || "",
			bytes: info.bytes,
		});
		return true;
	}

	if (route === "/api/catalog" && (method === "PUT" || method === "POST")) {
		if (!(await requireAdmin(req, res))) return true;
		const body = await readJson(req, config.limits.catalogMb + 2);
		const incoming = body && body.catalog ? body.catalog : body;

		const problem = catalog.validate(incoming);
		if (problem) {
			fail(res, 400, problem);
			return true;
		}

		incoming.updatedAt = new Date().toISOString();
		try {
			const saved = await catalog.write(incoming);
			const info = await catalog.stats();
			sendJson(res, 200, {
				ok: true,
				bytes: saved.bytes,
				backups: info.backups,
				updatedAt: incoming.updatedAt,
			});
		} catch (err) {
			fail(res, err.statusCode || 500, err.message || "Не удалось сохранить каталог");
		}
		return true;
	}

	if (route === "/api/catalog/stats" && method === "GET") {
		if (!(await requireAdmin(req, res))) return true;
		sendJson(res, 200, Object.assign({ ok: true }, await catalog.stats()));
		return true;
	}

	// Покупатель создаёт заказ, а читать и менять его может только администратор.
	if (route === "/api/orders" && method === "POST") {
		if (!allowOrder(req)) {
			fail(res, 429, "Слишком много заказов — попробуйте немного позже");
			return true;
		}
		const body = await readJson(req, 1);
		const catalogData = await catalog.read();
		if (!catalogData) {
			fail(res, 503, "Каталог временно недоступен");
			return true;
		}
		try {
			const order = await orders.create(body, catalogData);
			sendJson(res, 201, {
				ok: true,
				order: {
					id: order.id,
					number: order.number,
					createdAt: order.createdAt,
					quantity: order.quantity,
					total: order.total,
				},
			});
		} catch (err) {
			fail(res, err.status || 500, err.message || "Не удалось принять заказ");
		}
		return true;
	}

	if (route === "/api/orders" && method === "GET") {
		if (!(await requireAdmin(req, res))) return true;
		sendJson(res, 200, {
			ok: true,
			orders: await orders.list(),
			statuses: orders.STATUSES,
			stats: await orders.stats(),
		});
		return true;
	}

	const orderMatch = route.match(/^\/api\/orders\/([0-9a-f-]+)$/i);
	if (orderMatch && (method === "PATCH" || method === "PUT")) {
		if (!(await requireAdmin(req, res))) return true;
		const body = await readJson(req, 1);
		try {
			const order = await orders.updateStatus(orderMatch[1], String(body.status || ""));
			sendJson(res, 200, { ok: true, order });
		} catch (err) {
			fail(res, err.status || 500, err.message || "Не удалось обновить заказ");
		}
		return true;
	}

	if (route === "/api/session" && method === "GET") {
		sendJson(res, 200, {
			ok: true,
			authorized: await auth.isAuthorized(req),
			hasPassword: await auth.hasPassword(),
		});
		return true;
	}

	if (route === "/api/login" && method === "POST") {
		if (auth.tooManyAttempts(req)) {
			fail(res, 429, "Слишком много попыток — подождите несколько минут");
			return true;
		}
		const body = await readJson(req, 1);
		if (!(await auth.hasPassword())) {
			fail(res, 500, "На сервере не задан пароль: заполните ADMIN_PASSWORD в файле .env");
			return true;
		}
		if (!(await auth.checkPassword(body.password))) {
			auth.registerFailure(req);
			fail(res, 401, "Неверный пароль");
			return true;
		}
		auth.resetFailures(req);
		const token = await auth.makeToken();
		sendJson(res, 200, { ok: true, authorized: true }, { "set-cookie": auth.cookieHeader(token) });
		return true;
	}

	if (route === "/api/logout" && method === "POST") {
		sendJson(res, 200, { ok: true }, { "set-cookie": auth.cookieHeader("", 0) });
		return true;
	}

	if (route === "/api/password" && method === "POST") {
		if (!(await requireAdmin(req, res))) return true;
		const body = await readJson(req, 1);
		const result = await auth.changePassword(body.current, body.next);
		if (!result.ok) {
			fail(res, 400, result.error);
			return true;
		}
		const token = await auth.makeToken();
		sendJson(res, 200, { ok: true }, { "set-cookie": auth.cookieHeader(token) });
		return true;
	}

	// Фото: webp + миниатюра для списков товаров
	if (route === "/api/media/photo" && method === "POST") {
		if (!(await requireAdmin(req, res))) return true;
		const productId = url.searchParams.get("productId") || "common";
		const upload = await saveUpload(req, config.limits.uploadPhotoMb);
		try {
			const result = await media.transcodePhoto({
				inputPath: upload.file,
				workDir: config.tmpDir,
			});
			const key = mediaKey(productId, "photo", result.main.ext);
			const thumbKey = key.replace(/\.webp$/, ".thumb.webp");

			await storage.put(key, result.main.buffer, result.main.contentType, LONG_CACHE);
			await storage.put(thumbKey, result.thumb.buffer, result.thumb.contentType, LONG_CACHE);

			sendJson(res, 200, {
				ok: true,
				src: key,
				thumb: thumbKey,
				bytes: result.main.bytes,
				thumbBytes: result.thumb.bytes,
				sourceBytes: upload.bytes,
				width: result.meta.width,
				height: result.meta.height,
			});
		} catch (err) {
			console.error("Фото:", err.message);
			fail(res, 400, "Фото не обработалось: " + err.message);
		} finally {
			fsp.unlink(upload.file).catch(() => {});
		}
		return true;
	}

	// Видео: всегда 1080p, 30 кадров, до 20 секунд, H.264 + faststart
	if (route === "/api/media/video" && method === "POST") {
		if (!(await requireAdmin(req, res))) return true;
		const productId = url.searchParams.get("productId") || "common";
		const keepAudio = url.searchParams.get("sound") !== "0";
		const upload = await saveUpload(req, config.limits.uploadVideoMb);
		try {
			const result = await media.transcodeVideo({
				inputPath: upload.file,
				workDir: config.tmpDir,
				keepAudio,
			});

			const key = mediaKey(productId, "video", result.video.ext);
			await storage.put(key, result.video.buffer, result.video.contentType, LONG_CACHE);

			let posterKey = "";
			if (result.poster) {
				posterKey = key.replace(/\.mp4$/, ".poster.webp");
				await storage.put(posterKey, result.poster.buffer, result.poster.contentType, LONG_CACHE);
			}

			sendJson(res, 200, {
				ok: true,
				src: key,
				poster: posterKey,
				bytes: result.video.bytes,
				sourceBytes: upload.bytes,
				hasAudio: result.meta.hasAudio,
				label: result.meta.label,
				width: result.meta.width,
				height: result.meta.height,
				fps: result.meta.fps,
				duration: result.meta.duration,
				trimmed: result.meta.trimmed,
				sourceDuration: result.meta.sourceDuration,
			});
		} catch (err) {
			console.error("Видео:", err.message);
			fail(res, 400, "Видео не обработалось: " + err.message);
		} finally {
			fsp.unlink(upload.file).catch(() => {});
		}
		return true;
	}

	if (route === "/api/media/delete" && method === "POST") {
		if (!(await requireAdmin(req, res))) return true;
		const body = await readJson(req, 1);
		const keys = Array.isArray(body.keys) ? body.keys : [];
		let removed = 0;
		for (const key of keys) {
			if (typeof key !== "string" || !key) continue;
			if (/^https?:|^data:|^idb:|\.\./.test(key)) continue;
			try {
				await storage.delete(key);
				removed++;
			} catch (err) {
				/* уже удалён — не беда */
			}
		}
		sendJson(res, 200, { ok: true, removed });
		return true;
	}

	if (route === "/api/health" && method === "GET") {
		const deep = url.searchParams.get("deep") === "1";
		const info = {
			ok: true,
			storage: storage.driver,
			mediaBase: storage.mediaBase(),
			node: process.version,
			uptime: Math.round(process.uptime()),
			catalog: await catalog.stats().catch(() => null),
			orders: await orders.stats().catch(() => null),
		};
		if (deep) {
			try {
				await storage.healthcheck();
				info.storageOk = true;
			} catch (err) {
				info.storageOk = false;
				info.storageError = err.message;
			}
			info.tools = await checkTools();
		}
		sendJson(res, 200, info);
		return true;
	}

	return false;
}

/* -------------------------------- Сервер -------------------------------- */

const server = http.createServer((req, res) => {
	const url = new URL(req.url, "http://localhost");

	(async () => {
		if (url.pathname.startsWith("/api/")) {
			const handled = await handleApi(req, res, url);
			if (!handled) fail(res, 404, "Нет такого метода");
			return;
		}

		if (req.method !== "GET" && req.method !== "HEAD") {
			fail(res, 405, "Метод не поддерживается");
			return;
		}

		// Локальные медиа (режим без S3) — удобно для проверки без бакета
		if (url.pathname.startsWith("/media/")) {
			if (!storage.isLocal()) {
				fail(res, 404, "Медиа раздаёт хранилище S3, а не сервер");
				return;
			}
			const file = safeJoin(config.localMediaDir, url.pathname.slice("/media/".length));
			if (!file || !(await serveFile(req, res, file, LONG_CACHE))) {
				fail(res, 404, "Файл не найден");
			}
			return;
		}

		// Каталог товаров файлом — запасной путь и точка для внешних интеграций
		if (url.pathname === "/catalog.json") {
			const data = await catalog.read();
			sendJson(res, 200, data || {}, { "cache-control": "no-cache" });
			return;
		}

		const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
		const file = safeJoin(config.publicDir, rel);
		if (file) {
			const ext = path.extname(file).toLowerCase();
			const cache = ext === ".html" ? "no-cache" : "public, max-age=600, must-revalidate";
			if (await serveFile(req, res, file, cache)) return;
		}

		// Маршруты сайта живут после #, поэтому любой адрес без расширения — это index.html
		if (!path.extname(url.pathname)) {
			if (await serveFile(req, res, path.join(config.publicDir, "index.html"), "no-cache")) return;
		}

		res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
		res.end("Страница не найдена");
	})().catch((err) => {
		console.error("Ошибка запроса:", (err && err.message) || err);
		if (res.headersSent) {
			res.end();
			return;
		}
		fail(res, (err && err.status) || 500, (err && err.message) || "Внутренняя ошибка");
	});
});

// Загрузка видео с телефона может идти долго — даём ей время
server.requestTimeout = 30 * 60 * 1000;
server.headersTimeout = 60 * 1000;
server.keepAliveTimeout = 65 * 1000;

async function start() {
	await catalog.ensureDirs();
	await cleanTmp();
	setInterval(() => cleanTmp().catch(() => {}), 30 * 60 * 1000).unref();

	if (!(await auth.hasPassword())) {
		console.warn("[Фрейя] Не задан пароль админки: впишите ADMIN_PASSWORD в .env");
	}
	if (storage.driver === "s3" && !config.s3.bucket) {
		console.warn("[Фрейя] STORAGE_DRIVER=s3, но не заполнен S3_BUCKET");
	}
	const tools = await checkTools();
	if (!tools.ffmpeg || !tools.ffprobe) {
		console.warn(
			"[Фрейя] Не найден ffmpeg/ffprobe — загрузка фото и видео работать не будет. " +
				"Установите: apt install -y ffmpeg",
		);
	}

	server.listen(config.port, config.host, () => {
		console.log(
			"[Фрейя] сервер на http://" +
				config.host +
				":" +
				config.port +
				" · хранилище: " +
				storage.driver +
				" · медиа: " +
				storage.mediaBase() +
				" · каталог: " +
				config.catalogFile,
		);
	});
}

function shutdown(signal) {
	console.log("[Фрейя] остановка по " + signal);
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (err) => {
	console.error("[Фрейя] необработанная ошибка:", (err && err.message) || err);
});

start().catch((err) => {
	console.error("[Фрейя] не удалось запуститься:", err);
	process.exit(1);
});
