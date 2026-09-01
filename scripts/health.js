"use strict";
/* =========================================================================
   Проверка живого сервера: хранилище, ffmpeg, каталог.

   Запуск:  npm run health
   ========================================================================= */

const http = require("http");

const config = require("../server/lib/config");

const host = config.host === "0.0.0.0" ? "127.0.0.1" : config.host;

http
	.get(
		{ host, port: config.port, path: "/api/health?deep=1", timeout: 60000 },
		(res) => {
			const chunks = [];
			res.on("data", (chunk) => chunks.push(chunk));
			res.on("end", () => {
				let info;
				try {
					info = JSON.parse(Buffer.concat(chunks).toString("utf8"));
				} catch (err) {
					console.error("Сервер ответил не JSON-ом");
					process.exit(1);
				}

				const tools = info.tools || {};
				const catalogInfo = info.catalog || {};
				const ordersInfo = info.orders || {};
				const kb = catalogInfo.bytes ? Math.round(catalogInfo.bytes / 1024) + " КБ" : "пока пусто";

				console.log("");
				console.log("Сервер        : работает, Node " + info.node + ", " + info.uptime + " сек в воздухе");
				console.log("Хранилище    : " + info.storage + (info.storageOk === false ? " — ОШИБКА: " + info.storageError : " — запись/удаление работают"));
				console.log("Адрес медиа  : " + info.mediaBase);
				console.log("ffmpeg       : " + (tools.ffmpeg ? "есть" : "НЕТ — видео и фото не пережмутся"));
				console.log("ffprobe      : " + (tools.ffprobe ? "есть" : "НЕТ"));
				console.log("Каталог      : " + (catalogInfo.file || "неизвестно") + " · " + kb + " · копий: " + (catalogInfo.backups || 0));
				console.log("Заказы       : " + (ordersInfo.total || 0) + " · новых: " + ((ordersInfo.counts && ordersInfo.counts.new) || 0));
				console.log("");

				const bad = info.storageOk === false || !tools.ffmpeg || !tools.ffprobe;
				process.exit(bad ? 2 : 0);
			});
		},
	)
	.on("error", (err) => {
		console.error("Сервер не отвечает на " + host + ":" + config.port + " — " + err.message);
		console.error("Проверьте: systemctl status freya");
		process.exit(1);
	});
