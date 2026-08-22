"use strict";
/* =========================================================================
   Уборка хранилища: удаляет файлы, на которые больше нет ссылок в каталоге.

   По умолчанию только показывает, что бы удалил.

   Запуск:
     npm run gc-media            # только показать
     npm run gc-media -- --yes   # удалить
   ========================================================================= */

const storage = require("../server/lib/storage");
const catalog = require("../server/lib/catalog");

const confirm = process.argv.includes("--yes");

function usedKeys(data) {
	const keys = new Set();
	const add = (value) => {
		if (typeof value !== "string" || !value) return;
		if (/^https?:|^data:|^idb:/.test(value)) return;
		keys.add(value);
		if (/\.webp$/.test(value) && !/\.thumb\.webp$/.test(value)) {
			keys.add(value.replace(/\.webp$/, ".thumb.webp"));
		}
	};

	(data.products || []).forEach((product) => {
		(product.images || []).forEach(add);
		(product.videos || []).forEach((clip) => {
			if (!clip) return;
			add(clip.src);
			add(clip.poster);
		});
	});
	return keys;
}

async function main() {
	const data = await catalog.read();
	if (!data) {
		console.log("Каталога пока нет — на всякий случай ничего не трогаю");
		return;
	}

	const used = usedKeys(data);
	const all = await storage.list("products/");
	const orphans = all.filter((key) => !used.has(key));

	console.log("");
	console.log("Файлов в хранилище : " + all.length);
	console.log("Используется       : " + (all.length - orphans.length));
	console.log("Лишние             : " + orphans.length);

	if (!orphans.length) return;

	orphans.slice(0, 50).forEach((key) => console.log("   • " + key));
	if (orphans.length > 50) console.log("   … и ещё " + (orphans.length - 50));

	if (!confirm) {
		console.log("");
		console.log("Чтобы удалить, запустите: npm run gc-media -- --yes");
		return;
	}

	let removed = 0;
	for (const key of orphans) {
		try {
			await storage.delete(key);
			removed++;
		} catch (err) {
			console.log("   не удалось удалить " + key + ": " + err.message);
		}
	}
	console.log("");
	console.log("Удалено: " + removed);
}

main().catch((err) => {
	console.error("Ошибка уборки:", err.message);
	process.exit(1);
});
