"use strict";
/* =========================================================================
   Заказы магазина — файл DATA_DIR/orders.json.

   Заказ фиксирует название и цену товара в момент оформления, поэтому
   последующие изменения каталога не меняют уже принятые заказы.
   Запись атомарная и выстроена в очередь, как у каталога.
   ========================================================================= */

const crypto = require("crypto");
const fsp = require("fs/promises");
const path = require("path");

const config = require("./config");

const STATUSES = [
	{ id: "new", label: "Новый" },
	{ id: "processing", label: "В работе" },
	{ id: "awaiting_customer", label: "Ожидает ответа клиента" },
	{ id: "confirmed", label: "Подтверждён" },
	{ id: "shipped", label: "Отправлен" },
	{ id: "completed", label: "Выполнен" },
	{ id: "cancelled", label: "Отменён" },
];

const statusIds = new Set(STATUSES.map((item) => item.id));
let writeChain = Promise.resolve();

function emptyState() {
	return { version: 1, updatedAt: null, orders: [] };
}

async function readState() {
	try {
		const raw = await fsp.readFile(config.ordersFile, "utf8");
		const data = JSON.parse(raw);
		if (!data || typeof data !== "object" || !Array.isArray(data.orders)) return emptyState();
		return data;
	} catch (err) {
		if (err.code === "ENOENT") return emptyState();
		throw err;
	}
}

async function writeNow(state) {
	await fsp.mkdir(config.dataDir, { recursive: true });
	await fsp.mkdir(config.tmpDir, { recursive: true });
	state.updatedAt = new Date().toISOString();
	const payload = JSON.stringify(state, null, 2);
	const tmp = path.join(config.tmpDir, "orders-" + process.pid + "-" + Date.now() + ".json");
	await fsp.writeFile(tmp, payload, "utf8");
	await fsp.rename(tmp, config.ordersFile);
	return state;
}

function enqueue(change) {
	const next = writeChain.then(async () => {
		const state = await readState();
		const result = await change(state);
		await writeNow(state);
		return result;
	}, async () => {
		const state = await readState();
		const result = await change(state);
		await writeNow(state);
		return result;
	});
	writeChain = next.catch(() => {});
	return next;
}

function cleanText(value, max) {
	return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizePhone(value) {
	let digits = String(value || "").replace(/\D/g, "");
	if (digits.length === 10) digits = "7" + digits;
	if (digits.length === 11 && digits[0] === "8") digits = "7" + digits.slice(1);
	if (digits.length !== 11 || digits[0] !== "7") return "";
	return "+7 (" + digits.slice(1, 4) + ") " + digits.slice(4, 7) + "-" + digits.slice(7, 9) + "-" + digits.slice(9);
}

function makeNumber(existing) {
	let max = 0;
	existing.forEach((order) => {
		const match = String(order && order.number || "").match(/^A(\d{4})$/);
		if (match) max = Math.max(max, Number(match[1]) || 0);
	});
	const next = max + 1;
	if (next > 9999) {
		throw Object.assign(new Error("Закончились номера заказов — требуется новый диапазон"), { status: 503 });
	}
	return "A" + String(next).padStart(4, "0");
}

function buildItems(rawItems, catalogData) {
	if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 50) {
		throw Object.assign(new Error("В заказе нет товаров"), { status: 400 });
	}
	const products = Array.isArray(catalogData && catalogData.products) ? catalogData.products : [];
	return rawItems.map((raw) => {
		const productId = cleanText(raw && raw.id, 80);
		const product = products.find((item) => item && item.id === productId && item.isActive !== false);
		if (!product) {
			throw Object.assign(new Error("Один из товаров больше недоступен — обновите корзину"), { status: 409 });
		}
		const qty = Math.max(1, Math.min(20, Math.round(Number(raw.qty) || 1)));
		const unitPrice = Math.max(0, Math.round(Number(product.price) || 0));
		return {
			productId,
			name: cleanText(product.name, 160) || "Товар",
			size: cleanText(raw.size, 30),
			color: cleanText(raw.color, 80),
			qty,
			unitPrice,
			total: unitPrice * qty,
		};
	});
}

async function create(input, catalogData) {
	const name = cleanText(input && input.name, 100);
	const phone = normalizePhone(input && input.phone);
	if (name.length < 2) throw Object.assign(new Error("Укажите имя"), { status: 400 });
	if (!phone) throw Object.assign(new Error("Укажите телефон полностью"), { status: 400 });
	const items = buildItems(input && input.items, catalogData);
	const total = items.reduce((sum, item) => sum + item.total, 0);
	const quantity = items.reduce((sum, item) => sum + item.qty, 0);

	return enqueue((state) => {
		const now = new Date().toISOString();
		const number = makeNumber(state.orders);
		const order = {
			id: crypto.randomUUID(),
			number,
			createdAt: now,
			updatedAt: now,
			status: "new",
			customer: { name, phone },
			items,
			quantity,
			total,
			history: [{ status: "new", at: now }],
		};
		state.orders.unshift(order);
		return order;
	});
}

async function list() {
	const state = await readState();
	return state.orders.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function updateStatus(id, status) {
	if (!statusIds.has(status)) {
		throw Object.assign(new Error("Неизвестный статус заказа"), { status: 400 });
	}
	return enqueue((state) => {
		const order = state.orders.find((item) => item && item.id === id);
		if (!order) throw Object.assign(new Error("Заказ не найден"), { status: 404 });
		if (order.status !== status) {
			const now = new Date().toISOString();
			order.status = status;
			order.updatedAt = now;
			if (!Array.isArray(order.history)) order.history = [];
			order.history.push({ status, at: now });
		}
		return order;
	});
}

async function stats() {
	const state = await readState();
	const counts = {};
	STATUSES.forEach((item) => { counts[item.id] = 0; });
	state.orders.forEach((order) => {
		if (counts[order.status] !== undefined) counts[order.status]++;
	});
	return { total: state.orders.length, counts, updatedAt: state.updatedAt };
}

module.exports = { STATUSES, create, list, updateStatus, stats, normalizePhone };
