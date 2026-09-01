/* =========================================================================
   Фрейя — слой связи с сервером (каталог и медиа).

   Зачем отдельный файл: data.js отвечает за структуру данных,
   api.js — только за сеть. Так легче менять хранилище без правок логики сайта.

   В каталоге всегда лежат ОТНОСИТЕЛЬНЫЕ ключи:
     products/plate-lino/photo-3f2a.webp
   Полный адрес собирается в mediaUrl() из mediaBase, который приходит с сервера.
   Поэтому переезд на CDN или в другой бакет — правка одной переменной на сервере.
   ========================================================================= */
(function (global) {
	"use strict";

	var BASE_KEY = "freya_media_base";

	// первый кадр рисуем сразу: адрес хранилища кэшируется в браузере
	var mediaBase = "";
	try {
		mediaBase = global.localStorage.getItem(BASE_KEY) || "";
	} catch (e) {
		mediaBase = "";
	}

	var limits = {
		video: { maxSeconds: 20, fps: 30, shortSide: 1080, longSide: 1920 },
		uploadPhotoMb: 40,
		uploadVideoMb: 400
	};

	function setMediaBase(value) {
		if (typeof value !== "string" || !value) return;
		mediaBase = value.replace(/\/+$/, "");
		try {
			global.localStorage.setItem(BASE_KEY, mediaBase);
		} catch (e) {}
	}

	function isAbsolute(src) {
		return /^(https?:|data:|blob:|\/\/)/.test(src);
	}

	// Собирает публичный адрес фаи́ла.
	// opts.thumb — попросить маленькую версию (для плитки каталога)
	function mediaUrl(src, opts) {
		if (typeof src !== "string" || !src) return "";
		if (src.indexOf("idb:") === 0) return ""; // легаси из старого браузерного хранилища
		if (isAbsolute(src)) return src;
		if (src.charAt(0) === "/") return src;

		var key = src;
		if (opts && opts.thumb && /\.webp$/.test(key) && !/\.thumb\.webp$/.test(key)) {
			key = key.replace(/\.webp$/, ".thumb.webp");
		}
		if (!mediaBase) return "/media/" + key;
		return mediaBase + "/" + key;
	}

	/* ------------------------------ Запросы ------------------------------ */

	function request(method, url, body, done) {
		var options = {
			method: method,
			credentials: "same-origin",
			cache: "no-store",
			headers: {}
		};
		if (body !== undefined && body !== null) {
			options.headers["content-type"] = "application/json; charset=utf-8";
			options.body = JSON.stringify(body);
		}
		if (!global.fetch) {
			done({ ok: false, error: "Браузер слишком старый" });
			return;
		}
		global
			.fetch(url, options)
			.then(function (response) {
				return response
					.json()
					.catch(function () {
						return {};
					})
					.then(function (json) {
						if (!response.ok) {
							done({
								ok: false,
								status: response.status,
								error: json && json.error ? json.error : "Ошибка сервера " + response.status
							});
							return;
						}
						done({ ok: true, status: response.status, data: json });
					});
			})
			.catch(function (err) {
				done({ ok: false, error: "Нет связи с сервером" + (err && err.message ? " (" + err.message + ")" : "") });
			});
	}

	// Файлы уходят сырым телом запроса — без multipart, зато с прогрессом
	function upload(url, file, onProgress, done) {
		var xhr = new XMLHttpRequest();
		xhr.open("POST", url, true);
		xhr.withCredentials = true;
		xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
		xhr.timeout = 20 * 60 * 1000;

		if (xhr.upload && onProgress) {
			xhr.upload.onprogress = function (event) {
				if (!event.lengthComputable) return;
				onProgress(Math.round((event.loaded / event.total) * 100));
			};
		}

		xhr.onload = function () {
			var json = {};
			try {
				json = JSON.parse(xhr.responseText || "{}");
			} catch (e) {}
			if (xhr.status >= 200 && xhr.status < 300) {
				done({ ok: true, data: json });
				return;
			}
			done({
				ok: false,
				status: xhr.status,
				error: json && json.error ? json.error : "Сервер ответил " + xhr.status
			});
		};
		xhr.onerror = function () {
			done({ ok: false, error: "Не удалось отправить файл — проверьте связь" });
		};
		xhr.ontimeout = function () {
			done({ ok: false, error: "Сервер не успел обработать файл" });
		};
		xhr.send(file);
		return xhr;
	}

	function query(params) {
		var parts = [];
		Object.keys(params || {}).forEach(function (name) {
			var value = params[name];
			if (value === undefined || value === null || value === "") return;
			parts.push(encodeURIComponent(name) + "=" + encodeURIComponent(value));
		});
		return parts.length ? "?" + parts.join("&") : "";
	}

	/* ------------------------------ Интерфейс ------------------------------ */

	var Api = {
		mediaUrl: mediaUrl,
		setMediaBase: setMediaBase,
		mediaBase: function () {
			return mediaBase;
		},
		limits: function () {
			return limits;
		},

		config: function (done) {
			request("GET", "/api/config", null, function (res) {
				if (res.ok && res.data) {
					setMediaBase(res.data.mediaBase);
					if (res.data.video) limits.video = res.data.video;
					if (res.data.limits) {
						limits.uploadPhotoMb = res.data.limits.uploadPhotoMb || limits.uploadPhotoMb;
						limits.uploadVideoMb = res.data.limits.uploadVideoMb || limits.uploadVideoMb;
					}
				}
				done(res);
			});
		},

		getCatalog: function (done) {
			request("GET", "/api/catalog", null, function (res) {
				if (res.ok && res.data) setMediaBase(res.data.mediaBase);
				done(res);
			});
		},

		putCatalog: function (data, done) {
			request("PUT", "/api/catalog", { catalog: data }, done);
		},

		createOrder: function (data, done) {
			request("POST", "/api/orders", data, done);
		},

		getOrders: function (done) {
			request("GET", "/api/orders", null, done);
		},

		updateOrderStatus: function (id, status, done) {
			request("PATCH", "/api/orders/" + encodeURIComponent(id), { status: status }, done);
		},

		session: function (done) {
			request("GET", "/api/session", null, done);
		},

		login: function (password, done) {
			request("POST", "/api/login", { password: password }, done);
		},

		logout: function (done) {
			request("POST", "/api/logout", {}, done || function () {});
		},

		changePassword: function (current, next, done) {
			request("POST", "/api/password", { current: current, next: next }, done);
		},

		stats: function (done) {
			request("GET", "/api/catalog/stats", null, done);
		},

		health: function (deep, done) {
			request("GET", "/api/health" + (deep ? "?deep=1" : ""), null, done);
		},

		uploadPhoto: function (file, productId, onProgress, done) {
			return upload(
				"/api/media/photo" + query({ productId: productId }),
				file,
				onProgress,
				done
			);
		},

		uploadVideo: function (file, productId, keepSound, onProgress, done) {
			return upload(
				"/api/media/video" + query({ productId: productId, sound: keepSound ? "1" : "0" }),
				file,
				onProgress,
				done
			);
		},

		deleteMedia: function (keys, done) {
			request("POST", "/api/media/delete", { keys: keys }, done || function () {});
		}
	};

	global.FreyaApi = Api;
})(window);
