"use strict";
/* =========================================================================
   Перенос старого каталога (выгрузка из прежней админки) в новую схему.

   В старом сайте фото лежали внутри JSON в виде base64 (data:image/...),
   а видео — в IndexedDB браузера (idb:v...).

   Скрипт:
     • всё, что в виде base64, пережимает ffmpeg и кладёт в хранилище (S3)
     • в каталоге оставляет только короткие ключи файлов
     • ссылки idb: восстановить невозможно (они были только в браузере) —
       такие видео убираем и перечисляем товары, где ролик надо залить заново
     • внешние ссылки http(s) оставляет как есть

   Запуск:
     npm run migrate -- путь/к/catalog-export.json          # только показать план
     npm run migrate -- путь/к/catalog-export.json --write  # залить и сохранить
   ========================================================================= */

const fsp = require("fs/promises");
const path = require("path");

const config = require("../server/lib/config");
const storage = require("../server/lib/storage");
const media = require("../server/lib/media");
const catalog = require("../server/lib/catalog");

const LONG_CACHE = "public, max-age=31536000, immutable";

const args = process.argv.slice(2);
const write = args.includes("--write");
const file = args.find((value) => !value.startsWith("--"));

function slug(text) {
	const out = String(text || "")
		.toLowerCase()
		.replace(/[^a-z0-9\-_]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 48);
	return out || "common";
}

function dataUrlToBuffer(value) {
	const at = value.indexOf(",");
	if (at < 0) return null;
	try {
		return Buffer.from(value.slice(at + 1), "base64");
	} catch (err) {
		return null;
	}
}

async function tmpFile(buffer, ext) {
	await fsp.mkdir(config.tmpDir, { recursive: true });
	const target = path.join(config.tmpDir, "migrate-" + media.shortId() + "." + ext);
	await fsp.writeFile(target, buffer);
	return target;
}

async function uploadPhoto(buffer, productId) {
	const input = await tmpFile(buffer, "bin");
	try {
		const result = await media.transcodePhoto({ inputPath: input, workDir: config.tmpDir });
		const key = "products/" + slug(productId) + "/photo-" + media.shortId() + ".webp";
		const thumbKey = key.replace(/\.webp$/, ".thumb.webp");
		await storage.put(key, result.main.buffer, result.main.contentType, LONG_CACHE);
		await storage.put(thumbKey, result.thumb.buffer, result.thumb.contentType, LONG_CACHE);
		return key;
	} finally {
		fsp.unlink(input).catch(() => {});
	}
}

async function uploadVideo(buffer, productId, keepAudio) {
	const input = await tmpFile(buffer, "bin");
	try {
		const result = await media.transcodeVideo({
			inputPath: input,
			workDir: config.tmpDir,
			keepAudio,
		});
		const key = "products/" + slug(productId) + "/video-" + media.shortId() + ".mp4";
		await storage.put(key, result.video.buffer, result.video.contentType, LONG_CACHE);
		let poster = "";
		if (result.poster) {
			poster = key.replace(/\.mp4$/, ".poster.webp");
			await storage.put(poster, result.poster.buffer, result.poster.contentType, LONG_CACHE);
		}
		return { key, poster, meta: result.meta, bytes: result.video.bytes };
	} finally {
		fsp.unlink(input).catch(() => {});
	}
}

async function main() {
	if (!file) {
		console.log("Укажите файл: npm run migrate -- catalog-export.json [--write]");
		process.exit(1);
	}

	const raw = await fsp.readFile(path.resolve(file), "utf8");
	const data = JSON.parse(raw);
	if (!data || !Array.isArray(data.products)) {
		console.log("Это не похоже на каталог: нет списка products");
		process.exit(1);
	}

	let photos = 0;
	let videos = 0;
	const lostVideos = [];

	for (const product of data.products) {
		const id = product.id || product.name || "common";

		// Фото
		const images = Array.isArray(product.images) ? product.images : [];
		const nextImages = [];
		for (const src of images) {
			if (typeof src !== "string" || !src) continue;
			if (src.startsWith("data:")) {
				photos++;
				if (!write) continue;
				const buffer = dataUrlToBuffer(src);
				if (!buffer) continue;
				try {
					nextImages.push(await uploadPhoto(buffer, id));
					console.log("  фото → хранилище: " + (product.name || id));
				} catch (err) {
					console.log("  ФОТО НЕ ПОЛУЧИЛОСЬ (" + (product.name || id) + "): " + err.message);
				}
				continue;
			}
			if (src.startsWith("idb:")) continue; // такого у фото не бывало, но на всякий случай
			nextImages.push(src);
		}
		if (write) product.images = nextImages;

		// Видео
		const clips = Array.isArray(product.videos) ? product.videos : [];
		const nextClips = [];
		for (const clip of clips) {
			if (!clip || typeof clip !== "object" || typeof clip.src !== "string") continue;

			if (clip.src.startsWith("idb:")) {
				lostVideos.push(product.name || id);
				continue;
			}
			if (clip.src.startsWith("data:")) {
				videos++;
				if (!write) continue;
				const buffer = dataUrlToBuffer(clip.src);
				if (!buffer) continue;
				try {
					const up = await uploadVideo(buffer, id, clip.hasAudio !== false);
					nextClips.push({
						src: up.key,
						poster: up.poster,
						bytes: up.bytes,
						label: up.meta.label,
						hasAudio: up.meta.hasAudio,
					});
					console.log(
						"  видео → хранилище: " +
							(product.name || id) +
							" · " +
							up.meta.label +
							" · " +
							up.meta.duration +
							" сек",
					);
				} catch (err) {
					console.log("  ВИДЕО НЕ ПОЛУЧИЛОСЬ (" + (product.name || id) + "): " + err.message);
				}
				continue;
			}
			if (typeof clip.poster === "string" && clip.poster.startsWith("data:")) {
				clip.poster = "";
			}
			nextClips.push(clip);
		}
		if (write) product.videos = nextClips;
	}

	console.log("");
	console.log("Фото внутри файла (base64): " + photos);
	console.log("Видео внутри файла (base64): " + videos);
	console.log("Видео только в браузере (idb:), надо залить вручную: " + lostVideos.length);
	if (lostVideos.length) {
		Array.from(new Set(lostVideos)).forEach((name) => console.log("   • " + name));
	}

	if (!write) {
		console.log("");
		console.log("Это был только разбор. Для реального переноса добавьте --write");
		return;
	}

	data.updatedAt = new Date().toISOString();
	const problem = catalog.validate(data);
	if (problem) {
		console.log("");
		console.log("Каталог не прошёл проверку: " + problem);
		process.exit(1);
	}
	const saved = await catalog.write(data);
	console.log("");
	console.log("Готово: " + config.catalogFile + " · " + Math.round(saved.bytes / 1024) + " КБ");
	console.log("Хранилище: " + storage.driver + " · " + storage.mediaBase());
}

main().catch((err) => {
	console.error("Ошибка переноса:", err.message);
	process.exit(1);
});
