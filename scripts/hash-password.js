"use strict";
/* =========================================================================
   Генератор хеша пароля для ADMIN_PASSWORD_HASH.

   Зачем: чтобы в .env не лежал открытый пароль.

   Запуск:  npm run hash-password -- мой-пароль
   ========================================================================= */

const auth = require("../server/lib/auth");

const password = process.argv.slice(2).join(" ").trim();

if (!password) {
	console.log("Укажите пароль: npm run hash-password -- мой-пароль");
	process.exit(1);
}
if (password.length < 6) {
	console.log("Пароль короче 6 символов — такой легко подобрать");
	process.exit(1);
}

auth
	.makeHash(password)
	.then((hash) => {
		console.log("");
		console.log("Вставьте эту строку в .env (и уберите ADMIN_PASSWORD):");
		console.log("");
		console.log("ADMIN_PASSWORD_HASH=" + hash);
		console.log("");
	})
	.catch((err) => {
		console.error("Не удалось посчитать хеш:", err.message);
		process.exit(1);
	});
