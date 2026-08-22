"use strict";
/* =========================================================================
   Хранилище медиа.

   Два драйвера:
     s3    — Timeweb S3 (подпись AWS SigV4 своими руками, без aws-sdk)
     local — файлы на диске сервера в DATA_DIR/media (для теста и как запас)

   В каталоге хранятся ОТНОСИТЕЛЬНЫЕ ключи вида products/<id>/photo-1-ab12.webp,
   поэтому смена бакета или подключение CDN — это правка одной переменной.
   ========================================================================= */

const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const https = require("https");
const http = require("http");

const config = require("./config");

const EMPTY_SHA256 = crypto.createHash("sha256").update("").digest("hex");

function uriEncode(text, keepSlash) {
	let out = "";
	for (const char of String(text)) {
		if (/[A-Za-z0-9\-._~]/.test(char)) {
			out += char;
		} else if (char === "/" && keepSlash) {
			out += "/";
		} else {
			out += Array.from(Buffer.from(char, "utf8"))
				.map((byte) => "%" + byte.toString(16).toUpperCase().padStart(2, "0"))
				.join("");
		}
	}
	return out;
}

function hmac(key, value) {
	return crypto.createHmac("sha256", key).update(value, "utf8").digest();
}

function sha256hex(value) {
	return crypto.createHash("sha256").update(value).digest("hex");
}

function amzDate(now) {
	const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
	return { full: iso, short: iso.slice(0, 8) };
}

/* ------------------------------- Драйвер S3 ------------------------------- */

function s3Request({ method, key, query, body, headers }) {
	const s3 = config.s3;
	if (!s3.bucket) return Promise.reject(new Error("S3_BUCKET не задан"));
	if (!s3.accessKey || !s3.secretKey) {
		return Promise.reject(new Error("S3_ACCESS_KEY / S3_SECRET_KEY не заданы"));
	}

	const endpoint = new URL(s3.endpoint);
	const isHttps = endpoint.protocol === "https:";
	const transport = isHttps ? https : http;

	const objectPath = key ? uriEncode(key, true) : "";
	const canonicalUri = s3.forcePathStyle
		? "/" + uriEncode(s3.bucket, false) + (objectPath ? "/" + objectPath : "/")
		: "/" + objectPath;
	const hostHeader = s3.forcePathStyle
		? endpoint.host
		: s3.bucket + "." + endpoint.host;

	const queryPairs = Object.entries(query || {})
		.filter(([, value]) => value !== undefined && value !== null && value !== "")
		.map(([name, value]) => [uriEncode(name, false), uriEncode(value, false)])
		.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
	const canonicalQuery = queryPairs
		.map(([name, value]) => name + "=" + value)
		.join("&");

	const payload = body ? Buffer.from(body) : Buffer.alloc(0);
	const payloadHash = payload.length ? sha256hex(payload) : EMPTY_SHA256;

	const now = new Date();
	const stamp = amzDate(now);

	const allHeaders = Object.assign({}, headers || {});
	allHeaders.host = hostHeader;
	allHeaders["x-amz-content-sha256"] = payloadHash;
	allHeaders["x-amz-date"] = stamp.full;
	if (payload.length) allHeaders["content-length"] = String(payload.length);

	const signable = Object.keys(allHeaders)
		.map((name) => name.toLowerCase())
		.filter((name) => name !== "content-length")
		.sort();
	const canonicalHeaders =
		signable
			.map((name) => name + ":" + String(allHeaders[name]).trim() + "\n")
			.join("") || "";
	const signedHeaders = signable.join(";");

	const canonicalRequest = [
		method,
		canonicalUri,
		canonicalQuery,
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	].join("\n");

	const scope = [stamp.short, s3.region, "s3", "aws4_request"].join("/");
	const stringToSign = [
		"AWS4-HMAC-SHA256",
		stamp.full,
		scope,
		sha256hex(canonicalRequest),
	].join("\n");

	const kDate = hmac("AWS4" + s3.secretKey, stamp.short);
	const kRegion = hmac(kDate, s3.region);
	const kService = hmac(kRegion, "s3");
	const kSigning = hmac(kService, "aws4_request");
	const signature = crypto
		.createHmac("sha256", kSigning)
		.update(stringToSign, "utf8")
		.digest("hex");

	allHeaders.authorization =
		"AWS4-HMAC-SHA256 Credential=" +
		s3.accessKey +
		"/" +
		scope +
		", SignedHeaders=" +
		signedHeaders +
		", Signature=" +
		signature;

	const options = {
		method,
		host: endpoint.hostname,
		port: endpoint.port || (isHttps ? 443 : 80),
		path: canonicalUri + (canonicalQuery ? "?" + canonicalQuery : ""),
		headers: allHeaders,
		timeout: 120000,
	};

	return new Promise((resolve, reject) => {
		const req = transport.request(options, (res) => {
			const chunks = [];
			res.on("data", (chunk) => chunks.push(chunk));
			res.on("end", () => {
				const text = Buffer.concat(chunks).toString("utf8");
				if (res.statusCode >= 200 && res.statusCode < 300) {
					resolve({ status: res.statusCode, body: text, headers: res.headers });
					return;
				}
				const message =
					(text.match(/<Message>([^<]+)<\/Message>/) || [])[1] || text.slice(0, 300);
				reject(
					new Error("S3 " + method + " " + res.statusCode + ": " + message),
				);
			});
		});
		req.on("timeout", () => req.destroy(new Error("S3: таймаут запроса")));
		req.on("error", reject);
		if (payload.length) req.write(payload);
		req.end();
	});
}

/* ------------------------------ Общий интерфейс ------------------------------ */

async function putLocal(key, buffer) {
	const target = path.join(config.localMediaDir, key);
	await fsp.mkdir(path.dirname(target), { recursive: true });
	await fsp.writeFile(target, buffer);
	return key;
}

async function delLocal(key) {
	try {
		await fsp.unlink(path.join(config.localMediaDir, key));
	} catch (err) {
		if (err.code !== "ENOENT") throw err;
	}
}

async function listLocal(prefix) {
	const out = [];
	async function walk(dir, rel) {
		let entries;
		try {
			entries = await fsp.readdir(dir, { withFileTypes: true });
		} catch (err) {
			return;
		}
		for (const entry of entries) {
			const next = rel ? rel + "/" + entry.name : entry.name;
			if (entry.isDirectory()) await walk(path.join(dir, entry.name), next);
			else if (!prefix || next.startsWith(prefix)) out.push(next);
		}
	}
	await walk(config.localMediaDir, "");
	return out;
}

const storage = {
	driver: config.storageDriver === "local" ? "local" : "s3",

	isLocal() {
		return storage.driver === "local";
	},

	// Публичная база для ссылок на медиа
	mediaBase() {
		if (config.mediaBase) return config.mediaBase;
		if (storage.isLocal()) return "/media";
		const s3 = config.s3;
		const endpoint = String(s3.endpoint).replace(/\/+$/, "");
		return s3.forcePathStyle
			? endpoint + "/" + s3.bucket
			: endpoint.replace("://", "://" + s3.bucket + ".");
	},

	async put(key, buffer, contentType, cacheControl) {
		if (storage.isLocal()) return putLocal(key, buffer);
		await s3Request({
			method: "PUT",
			key,
			body: buffer,
			headers: {
				"content-type": contentType || "application/octet-stream",
				"cache-control": cacheControl || "public, max-age=31536000, immutable",
				"x-amz-acl": config.s3.acl,
			},
		});
		return key;
	},

	async delete(key) {
		if (storage.isLocal()) return delLocal(key);
		await s3Request({ method: "DELETE", key });
	},

	async list(prefix) {
		if (storage.isLocal()) return listLocal(prefix);
		const keys = [];
		let token = "";
		for (let page = 0; page < 200; page++) {
			const res = await s3Request({
				method: "GET",
				key: "",
				query: {
					"list-type": "2",
					prefix: prefix || "",
					"max-keys": "1000",
					"continuation-token": token || undefined,
				},
			});
			const body = res.body || "";
			const matches = body.match(/<Key>([^<]+)<\/Key>/g) || [];
			matches.forEach((raw) => {
				const value = raw.replace(/<\/?Key>/g, "");
				keys.push(
					value
						.replace(/&amp;/g, "&")
						.replace(/&lt;/g, "<")
						.replace(/&gt;/g, ">"),
				);
			});
			const truncated = /<IsTruncated>true<\/IsTruncated>/.test(body);
			const next = (body.match(
				/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/,
			) || [])[1];
			if (!truncated || !next) break;
			token = next;
		}
		return keys;
	},

	// Короткая самопроверка при старте: пишем и удаляем маленький объект
	async healthcheck() {
		const key = ".healthcheck/" + Date.now() + ".txt";
		await storage.put(key, Buffer.from("ok", "utf8"), "text/plain", "no-store");
		await storage.delete(key);
		return true;
	},
};

module.exports = storage;
