"use strict";
/* =========================================================================
   Каталог товаров — файл DATA_DIR/catalog.json.

   Главные гарантии:
     • файл лежит вне папки с кодом → деплой его не видит и не перезатирает
     • запись атомарная (tmp + rename) → нет битых файлов при сбое
     • перед каждой записью предыдущая версия уезжает в backups/
   ========================================================================= */

const fsp = require("fs/promises");
const path = require("path");

const config = require("./config");

let writeChain = Promise.resolve();

async function ensureDirs() {
	await fsp.mkdir(config.dataDir, { recursive: true });
	await fsp.mkdir(config.backupsDir, { recursive: true });
	await fsp.mkdir(config.tmpDir, { recursive: true });
}

async function read() {
	try {
		const raw = await fsp.readFile(config.catalogFile, "utf8");
		const data = JSON.parse(raw);
		if (!data || typeof data !== "object") return null;
		return data;
	} catch (err) {
		if (err.code === "ENOENT") return null;
		// битый JSON — поднимаем свежий бэкап, чтобы сайт не остался пустым
		const restored = await readLatestBackup();
		if (restored) return restored;
		throw err;
	}
}

async function readLatestBackup() {
	let files;
	try {
		files = await fsp.readdir(config.backupsDir);
	} catch (err) {
		return null;
	}
	const list = files
		.filter((name) => /^catalog-.*\.json$/.test(name))
		.sort()
		.reverse();
	for (const name of list) {
		try {
			const raw = await fsp.readFile(path.join(config.backupsDir, name), "utf8");
			const data = JSON.parse(raw);
			if (data && typeof data === "object") return data;
		} catch (err) {
			/* пробуем следующий */
		}
	}
	return null;
}

function validate(data) {
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		return "Ожидался объект каталога";
	}
	if (!Array.isArray(data.products)) return "Нет списка товаров (products)";
	if (!Array.isArray(data.categories)) return "Нет списка категорий (categories)";
	if (data.products.length > 5000) return "Слишком много товаров";

	// Страховка от возврата к base64: такие данные раздувают каталог
	let inlineCount = 0;
	data.products.forEach((product) => {
		if (!product || typeof product !== "object") return;
		(Array.isArray(product.images) ? product.images : []).forEach((src) => {
			if (typeof src === "string" && src.startsWith("data:")) inlineCount++;
		});
		(Array.isArray(product.videos) ? product.videos : []).forEach((item) => {
			const src = item && typeof item === "object" ? item.src : item;
			if (typeof src === "string" && (src.startsWith("data:") || src.startsWith("idb:"))) {
				inlineCount++;
			}
			if (item && typeof item === "object" && typeof item.poster === "string" && item.poster.startsWith("data:")) {
				inlineCount++;
			}
		});
	});
	if (inlineCount > 0) {
		return (
			"В каталоге осталось " +
			inlineCount +
			" встроенных файлов (base64/idb). Сначала перенесите их в хранилище"
		);
	}
	return null;
}

async function rotateBackups() {
	let files;
	try {
		files = await fsp.readdir(config.backupsDir);
	} catch (err) {
		return;
	}
	const list = files.filter((name) => /^catalog-.*\.json$/.test(name)).sort();
	const extra = list.slice(0, Math.max(0, list.length - config.backupsKeep));
	for (const name of extra) {
		try {
			await fsp.unlink(path.join(config.backupsDir, name));
		} catch (err) {
			/* не критично */
		}
	}
}

async function writeNow(data) {
	await ensureDirs();

	const payload = JSON.stringify(data, null, 2);
	const bytes = Buffer.byteLength(payload, "utf8");
	if (bytes > config.limits.catalogMb * 1024 * 1024) {
		throw Object.assign(
			new Error(
				"Каталог слишком большой (" +
					Math.round(bytes / 1024 / 1024) +
					" МБ). Фото и видео должны лежать в хранилище, а не в каталоге",
			),
			{ statusCode: 413 },
		);
	}

	// бэкап предыдущей версии
	try {
		const previous = await fsp.readFile(config.catalogFile);
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		await fsp.writeFile(
			path.join(config.backupsDir, "catalog-" + stamp + ".json"),
			previous,
		);
		await rotateBackups();
	} catch (err) {
		if (err.code !== "ENOENT") throw err;
	}

	const tmp = path.join(config.tmpDir, "catalog-" + process.pid + "-" + Date.now() + ".json");
	await fsp.writeFile(tmp, payload, "utf8");
	await fsp.rename(tmp, config.catalogFile);
	return { bytes };
}

// Записи выстраиваются в очередь: две одновременные правки не перебьют друг друга
function write(data) {
	const next = writeChain.then(() => writeNow(data), () => writeNow(data));
	writeChain = next.catch(() => {});
	return next;
}

async function stats() {
	let size = 0;
	let mtime = null;
	try {
		const stat = await fsp.stat(config.catalogFile);
		size = stat.size;
		mtime = stat.mtime.toISOString();
	} catch (err) {
		/* файла ещё нет */
	}
	let backups = 0;
	try {
		const files = await fsp.readdir(config.backupsDir);
		backups = files.filter((name) => /^catalog-.*\.json$/.test(name)).length;
	} catch (err) {
		/* папки ещё нет */
	}
	return { bytes: size, updatedAt: mtime, backups, file: config.catalogFile };
}

module.exports = { ensureDirs, read, write, validate, stats, readLatestBackup };
