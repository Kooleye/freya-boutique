/* =========================================================================
   Фрейя — слой данных каталога.
   Один и тот же файл использует и сайт (index.html), и админка (admin.html).

   Порядок загрузки:
     1) localStorage — правки из админки на этом устройстве
     2) catalog.json — опубликованный файл в корне сайта (виден всем посетителям)
     3) заводские данные ниже
   ========================================================================= */
(function (global) {
  "use strict";

  var STORAGE_KEY = "freya_catalog_v1";
  var PASS_KEY = "freya_admin_pass_v1";
  var DEFAULT_PASSWORD = "242564";
  var SIZES_DEFAULT = ["XS", "S", "M", "L"];

  function IMG(seed, count) {
    var list = [];
    for (var i = 1; i <= count; i++) {
      list.push("https://picsum.photos/seed/freya-" + seed + "-" + i + "/600/800");
    }
    return list;
  }

  // SVG-иконки категорий — выбираются в админке
  var ICONS = {
    grid:   '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
    dress:  '<path d="M9 3l3 2 3-2 1 4-2 2 2 10H8L10 9 8 7z"/>',
    suit:   '<path d="M6 3h12v18H6z"/><path d="M12 3v18M9 6h1M14 6h1"/>',
    coat:   '<path d="M8 3l4 3 4-3 3 3-2 15H7L5 6z"/><path d="M12 6v15"/>',
    top:    '<path d="M8 4L4 6l1 4h2v10h10V10h2l1-4-4-2-4 2z"/>',
    skirt:  '<path d="M9 4h6l1 4-3 12h-2L8 8z"/>',
    hanger: '<path d="M12 4.5a2 2 0 1 1 2 2c0 1.3-2 1.3-2 3M4 17.5l8-4 8 4-8 3.5z"/>',
    bag:    '<path d="M4.5 8.5h15l-1 11.5h-13z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/>',
    star:   '<path d="M12 4l2.4 5 5.6.6-4.2 3.8 1.2 5.6L12 16.4 7 19l1.2-5.6L4 9.6 9.6 9z"/>'
  };

  var ICON_NAMES = [
    { value: "dress",  label: "Платье" },
    { value: "suit",   label: "Костюм" },
    { value: "coat",   label: "Верхняя одежда" },
    { value: "top",    label: "Топ / блуза" },
    { value: "skirt",  label: "Юбка / брюки" },
    { value: "hanger", label: "Вешалка (универсальная)" },
    { value: "bag",    label: "Сумка / аксессуары" },
    { value: "star",   label: "Звезда / акция" },
    { value: "grid",   label: "Квадраты" }
  ];

  /* ------------------------------ Заводские данные ------------------------------ */

  var DEFAULT_DATA = {
    version: 1,
    updatedAt: null,

    settings: {
      shopName: "Фрейя",
      banner: "НОВАЯ КОЛЛЕКЦИЯ • ВЕСНА–ЛЕТО 2025",
      tagline1: "БУТИК ЖЕНСКОЙ ОДЕЖДЫ",
      tagline2: "ПРЕМИАЛЬНЫЙ ОПЫТ ПОКУПОК"
    },

    categories: [
      { slug: "dresses",   title: "Платья",          icon: "dress" },
      { slug: "suits",     title: "Костюмы",         icon: "suit" },
      { slug: "outerwear", title: "Верхняя одежда", icon: "coat" },
      { slug: "tops",      title: "Топы",             icon: "top" }
    ],

    products: [
      {
        id: "dress",
        name: "Платье комбинация из шелка",
        price: 8900,
        oldPrice: null,
        category: "dresses",
        isNew: true,
        isSale: false,
        isActive: true,
        color: "Изумрудный",
        colors: ["#1E3A2B", "#C6BDA9", "#2B2B2E"],
        sizes: ["XS", "S", "M", "L"],
        images: IMG("dress", 5),
        description: "Платье-комбинация из натурального шелка с косым кроем и тонкими бретелями. Мягко скользит по фигуре и держит линию силуэта. Длина ниже колена.",
        composition: ["100% натуральный шелк", "Подкладка: 100% вискоза", "Сухая чистка", "Глажение при низкой температуре"]
      },
      {
        id: "suit",
        name: "Костюм льняной двойка",
        price: 15900,
        oldPrice: null,
        category: "suits",
        isNew: true,
        isSale: false,
        isActive: true,
        color: "Бежевый",
        colors: ["#D8CDB8", "#2F3A32", "#FFFFFF"],
        sizes: ["XS", "S", "M", "L"],
        images: IMG("suit", 5),
        description: "Костюм из плотного льна: удлинённый жакет на подкладке и брюки свободного кроя со стрелками. Жакет и брюки можно носить по отдельности.",
        composition: ["70% лён, 30% вискоза", "Подкладка: 100% вискоза", "Деликатная стирка при 30°", "Глажение через ткань"]
      },
      {
        id: "drape",
        name: "Платье с драпировкой",
        price: 12900,
        oldPrice: null,
        category: "dresses",
        isNew: true,
        isSale: false,
        isActive: true,
        color: "Графитовый",
        colors: ["#3A3A3D", "#8E4B4B", "#D8CDB8"],
        sizes: ["XS", "S", "M", "L"],
        images: IMG("drape", 4),
        description: "Платье из трикотажного полотна с драпировкой на линии талии. Мягко подчёркивает фигуру, не стесняя движений.",
        composition: ["92% вискоза, 8% эластан", "Стирка при 30° в деликатном режиме", "Не отбеливать"]
      },
      {
        id: "blouse",
        name: "Блуза шелковая",
        price: 6900,
        oldPrice: null,
        category: "tops",
        isNew: false,
        isSale: false,
        isActive: true,
        color: "Молочный",
        colors: ["#F2EDE4", "#1E3A2B", "#2B2B2E"],
        sizes: ["XS", "S", "M", "L"],
        images: IMG("blouse", 4),
        description: "Прямая шелковая блуза свободного кроя с потайной застёжкой. Базовая вещь для костюмов и юбок.",
        composition: ["100% натуральный шелк", "Сухая чистка", "Глажение при низкой температуре"]
      },
      {
        id: "collar",
        name: "Блуза шелковая с воротником",
        price: 6900,
        oldPrice: null,
        category: "tops",
        isNew: false,
        isSale: false,
        isActive: true,
        color: "Молочный",
        colors: ["#F2EDE4", "#C6BDA9", "#3A3A3D"],
        sizes: ["XS", "S", "M", "L"],
        images: IMG("collar", 4),
        description: "Шелковая блуза с отложным воротником и аккуратными манжетами. Сидит чётко, без излишнего объёма.",
        composition: ["100% натуральный шелк", "Сухая чистка", "Не сушить в машине"]
      },
      {
        id: "coat",
        name: "Пальто шерстяное оверсайз",
        price: 24900,
        oldPrice: null,
        category: "outerwear",
        isNew: true,
        isSale: false,
        isActive: true,
        color: "Камель",
        colors: ["#B79268", "#2F3A32", "#3A3A3D"],
        sizes: ["XS", "S", "M", "L"],
        images: IMG("coat", 5),
        description: "Пальто свободного кроя из шерстяного полотна с мягкими плечами. Носится и на платье, и на костюм.",
        composition: ["80% шерсть, 20% полиамид", "Подкладка: 100% вискоза", "Сухая чистка"]
      },
      {
        id: "trench",
        name: "Тренч с поясом",
        price: 18900,
        oldPrice: null,
        category: "outerwear",
        isNew: true,
        isSale: false,
        isActive: true,
        color: "Песочный",
        colors: ["#CDBFA3", "#2F3A32", "#2B2B2E"],
        sizes: ["XS", "S", "M", "L"],
        images: IMG("trench", 5),
        description: "Классический тренч с широким поясом и двойной бортовкой. Длина по колено.",
        composition: ["65% коттон, 35% полиэстер", "Водоотталкивающая пропитка", "Сухая чистка"]
      },
      {
        id: "top",
        name: "Топ на тонких бретелях",
        price: 4900,
        oldPrice: null,
        category: "tops",
        isNew: true,
        isSale: false,
        isActive: true,
        color: "Графитовый",
        colors: ["#3A3A3D", "#F2EDE4", "#1E3A2B"],
        sizes: ["XS", "S", "M", "L"],
        images: IMG("top", 4),
        description: "Топ из плотного трикотажа на тонких регулируемых бретелях. Сочетается с костюмами и открытыми рубашками.",
        composition: ["95% вискоза, 5% эластан", "Стирка при 30°", "Не сушить в машине"]
      }
    ]
  };

  /* ------------------------------ Служебное ------------------------------ */

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function str(value, fallback) {
    return typeof value === "string" ? value : (fallback || "");
  }

  function num(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  // Кириллица → латиница для адресов вида #/catalog/platya
  function slugify(text) {
    var map = {
      а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
      й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
      у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
      э: "e", ю: "yu", я: "ya"
    };
    var out = String(text).toLowerCase().replace(/[\u0430-\u044f\u0451]/g, function (ch) {
      return map[ch] !== undefined ? map[ch] : ch;
    });
    return out.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  }

  function uniqueId(base, taken) {
    var reserved = ["all", "new"];
    var id = base || "item";
    if (reserved.indexOf(id) > -1) id = id + "-1";
    var candidate = id;
    var n = 2;
    while (taken.indexOf(candidate) > -1) {
      candidate = id + "-" + n;
      n++;
    }
    return candidate;
  }

  // Приводит любые данные (localStorage, catalog.json, импорт) к рабочему виду
  function normalize(input) {
    var data = (input && typeof input === "object") ? input : {};
    var out = {
      version: 1,
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
      settings: {},
      categories: [],
      products: []
    };

    var s = (data.settings && typeof data.settings === "object") ? data.settings : {};
    out.settings.shopName = str(s.shopName, DEFAULT_DATA.settings.shopName) || DEFAULT_DATA.settings.shopName;
    out.settings.banner = str(s.banner, DEFAULT_DATA.settings.banner);
    out.settings.tagline1 = str(s.tagline1, DEFAULT_DATA.settings.tagline1);
    out.settings.tagline2 = str(s.tagline2, DEFAULT_DATA.settings.tagline2);

    var cats = Array.isArray(data.categories) && data.categories.length
      ? data.categories
      : clone(DEFAULT_DATA.categories);
    var usedSlugs = [];

    cats.forEach(function (c) {
      if (!c || typeof c !== "object") return;
      var title = str(c.title, "").trim();
      if (!title) return;
      var slug = slugify(str(c.slug, "")) || slugify(title) || "category";
      slug = uniqueId(slug, usedSlugs);
      usedSlugs.push(slug);
      out.categories.push({
        slug: slug,
        title: title,
        icon: ICONS[c.icon] ? c.icon : "hanger"
      });
    });

    if (!out.categories.length) out.categories = clone(DEFAULT_DATA.categories);

    var items = Array.isArray(data.products) ? data.products : clone(DEFAULT_DATA.products);
    var usedIds = [];

    items.forEach(function (p) {
      if (!p || typeof p !== "object") return;
      var name = str(p.name, "").trim();
      if (!name) return;

      var category = str(p.category, "");
      var known = out.categories.some(function (c) { return c.slug === category; });
      if (!known) category = out.categories[0].slug;

      var images = Array.isArray(p.images) ? p.images.filter(function (x) {
        return typeof x === "string" && x.length > 0;
      }) : [];

      var videos = Array.isArray(p.videos) ? p.videos.map(function (v) {
        if (typeof v === "string") return { src: v, poster: "", label: "", bytes: 0, hasAudio: true };
        if (v && typeof v === "object" && typeof v.src === "string") {
          return {
            src: v.src,
            poster: typeof v.poster === "string" ? v.poster : "",
            label: typeof v.label === "string" ? v.label : "",
            bytes: typeof v.bytes === "number" && isFinite(v.bytes) ? Math.max(0, Math.round(v.bytes)) : 0,
            hasAudio: typeof v.hasAudio === "boolean" ? v.hasAudio : true
          };
        }
        return null;
      }).filter(function (v) { return v && v.src.length > 0; }) : [];

      var sizes = Array.isArray(p.sizes) ? p.sizes.filter(function (x) {
        return typeof x === "string" && x.trim().length > 0;
      }).map(function (x) { return x.trim(); }) : [];
      if (!sizes.length) sizes = SIZES_DEFAULT.slice();

      var colors = Array.isArray(p.colors) ? p.colors.filter(function (x) {
        return typeof x === "string" && /^#[0-9a-fA-F]{3,8}$/.test(x);
      }) : [];
      if (!colors.length) colors = ["#1E3A2B"];

      var composition = Array.isArray(p.composition)
        ? p.composition.filter(function (x) { return typeof x === "string" && x.trim().length > 0; })
          .map(function (x) { return x.trim(); })
        : [];

      var priceValue = Math.max(0, Math.round(num(p.price, 0)));
      var oldValue = p.oldPrice === null || p.oldPrice === undefined || p.oldPrice === ""
        ? null
        : Math.round(num(p.oldPrice, 0));
      if (oldValue !== null && oldValue <= priceValue) oldValue = null;

      var id = uniqueId(slugify(str(p.id, "")) || slugify(name) || "tovar", usedIds);
      usedIds.push(id);

      out.products.push({
        id: id,
        name: name,
        price: priceValue,
        oldPrice: oldValue,
        category: category,
        isNew: !!p.isNew,
        isSale: !!p.isSale,
        isActive: p.isActive === undefined ? true : !!p.isActive,
        color: str(p.color, "").trim(),
        colors: colors,
        sizes: sizes,
        images: images,
        videos: videos,
        description: str(p.description, "").trim(),
        composition: composition
      });
    });

    return out;
  }

  /* --------------------------- Видео в IndexedDB ---------------------------
     Сжатый 720p-ролик весит больше, чем весь localStorage (там всего ~5 МБ),
     поэтому сами видео лежат в IndexedDB, а в каталоге хранится ссылка idb:...
     ------------------------------------------------------------------------ */

  var DB_NAME = "freya_media";
  var DB_VERSION = 1;
  var DB_STORE = "videos";

  function openDb(done) {
    if (!global.indexedDB) { done(null); return; }
    var request;
    try { request = global.indexedDB.open(DB_NAME, DB_VERSION); }
    catch (err) { done(null); return; }

    request.onupgradeneeded = function () {
      var db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    request.onsuccess = function () { done(request.result); };
    request.onerror = function () { done(null); };
    request.onblocked = function () { done(null); };
  }

  function withStore(mode, run, done) {
    openDb(function (db) {
      if (!db) { done(null); return; }
      var tx, req;
      try {
        tx = db.transaction(DB_STORE, mode);
        req = run(tx.objectStore(DB_STORE));
      } catch (err) { done(null); return; }
      tx.oncomplete = function () { done(req ? req.result : true); };
      tx.onerror = function () { done(null); };
      tx.onabort = function () { done(null); };
    });
  }

  function newVideoId() {
    return "idb:v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function putVideo(id, dataUrl, done) {
    withStore("readwrite", function (store) { return store.put(dataUrl, id); }, function (res) {
      done(res !== null);
    });
  }

  function getVideo(id, done) {
    withStore("readonly", function (store) { return store.get(id); }, function (res) {
      done(typeof res === "string" ? res : null);
    });
  }

  function deleteVideo(id, done) {
    withStore("readwrite", function (store) { return store.delete(id); }, function () { done(true); });
  }

  function listVideoKeys(done) {
    withStore("readonly", function (store) {
      return store.getAllKeys ? store.getAllKeys() : null;
    }, function (res) { done(Array.isArray(res) ? res : []); });
  }

  // последовательный обход — без промисов, чтобы код шёл в старых браузерах
  function eachSeries(items, step, done) {
    var i = 0;
    function next() {
      if (i >= items.length) { done(); return; }
      var item = items[i];
      i++;
      step(item, next);
    }
    next();
  }

  function videoRefs(data) {
    var out = [];
    (data && data.products ? data.products : []).forEach(function (p) {
      (p.videos || []).forEach(function (v) {
        if (v && typeof v.src === "string") out.push(v);
      });
    });
    return out;
  }

  // для выгрузки catalog.json ролики подмешиваются обратно в файл
  function inlineVideos(data, done) {
    var copy = clone(data);
    var jobs = videoRefs(copy).filter(function (v) { return v.src.indexOf("idb:") === 0; });
    eachSeries(jobs, function (v, next) {
      getVideo(v.src, function (value) {
        if (value) v.src = value;
        next();
      });
    }, function () { done(copy); });
  }

  // при импорте тяжёлые ролики из файла убираем в IndexedDB
  function absorbVideos(data, done) {
    var jobs = videoRefs(data).filter(function (v) { return v.src.indexOf("data:") === 0; });
    eachSeries(jobs, function (v, next) {
      var id = newVideoId();
      putVideo(id, v.src, function (ok) {
        if (ok) v.src = id;
        next();
      });
    }, function () { done(data); });
  }

  // удаляем ролики, на которые больше никто не ссылается
  function cleanupVideos(data, done) {
    var used = {};
    videoRefs(data).forEach(function (v) { used[v.src] = true; });
    listVideoKeys(function (keys) {
      var extra = keys.filter(function (key) { return !used[key]; });
      eachSeries(extra, function (key, next) {
        deleteVideo(key, function () { next(); });
      }, function () { done(extra.length); });
    });
  }

  function estimate(done) {
    var nav = global.navigator;
    if (!nav || !nav.storage || !nav.storage.estimate) { done(null); return; }
    try {
      nav.storage.estimate().then(function (info) {
        done({ usage: info.usage || 0, quota: info.quota || 0 });
      }, function () { done(null); });
    } catch (err) { done(null); }
  }

  /* ------------------------------ Хранилище ------------------------------ */

  function readLocal() {
    try {
      var raw = global.localStorage ? global.localStorage.getItem(STORAGE_KEY) : null;
      if (!raw) return null;
      return normalize(JSON.parse(raw));
    } catch (e) {
      return null;
    }
  }

  // Все ссылки на медиа собирает api.js — только он знает адрес S3/CDN.
  // В каталоге лежат короткие ключи вида products/<id>/photo-ab12.webp
  function mediaUrl(src, opts) {
    if (global.FreyaApi) return global.FreyaApi.mediaUrl(src, opts);
    return typeof src === "string" ? src : "";
  }

  var Data = {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_PASSWORD: DEFAULT_PASSWORD,
    SIZES_DEFAULT: SIZES_DEFAULT.slice(),
    ICONS: ICONS,
    ICON_NAMES: ICON_NAMES,
    icon: function (name) { return ICONS[name] || ICONS.hanger; },

    defaults: function () { return normalize(clone(DEFAULT_DATA)); },
    normalize: normalize,
    clone: clone,
    slugify: slugify,
    uniqueId: uniqueId,

    hasLocal: function () { return readLocal() !== null; },
    local: readLocal,

    save: function (data) {
      var clean = normalize(data);
      try {
        global.localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
        return { ok: true, data: clean };
      } catch (e) {
        // чаще всего — переполнение хранилища браузера из-за тяжёлых фото
        return { ok: false, error: (e && e.name) ? e.name : "error", data: clean };
      }
    },

    reset: function () {
      try { global.localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      return Data.defaults();
    },

    // Сайт: сервер (/api/catalog) → файл catalog.json → заводские данные.
    // Браузерное хранилище больше не главный источник: каталог живёт на сервере,
    // поэтому все телефоны видят одни и те же товары.
    load: function (done) {
      if (!global.fetch || location.protocol === "file:") {
        var offline = readLocal();
        done(offline || Data.defaults(), offline ? "local" : "default");
        return;
      }

      var finished = false;
      var finish = function (result, source) {
        if (finished) return;
        finished = true;
        done(result, source);
      };
      var timer = setTimeout(function () { finish(Data.defaults(), "default"); }, 10000);

      var fromFile = function () {
        fetch("catalog.json", { cache: "no-store" })
          .then(function (r) { if (!r.ok) throw new Error("no file"); return r.json(); })
          .then(function (json) { clearTimeout(timer); finish(normalize(json), "published"); })
          .catch(function () { clearTimeout(timer); finish(Data.defaults(), "default"); });
      };

      if (!global.FreyaApi) { fromFile(); return; }
      global.FreyaApi.getCatalog(function (res) {
        if (res.ok && res.data && res.data.catalog) {
          clearTimeout(timer);
          finish(normalize(res.data.catalog), "server");
          return;
        }
        fromFile();
      });
    },

    password: function () {
      try {
        return global.localStorage.getItem(PASS_KEY) || DEFAULT_PASSWORD;
      } catch (e) {
        return DEFAULT_PASSWORD;
      }
    },

    setPassword: function (value) {
      try { global.localStorage.setItem(PASS_KEY, String(value)); } catch (e) {}
    },

    // Сколько места занято в браузере (лимит около 5 МБ)
    usage: function () {
      var raw = "";
      try { raw = global.localStorage.getItem(STORAGE_KEY) || ""; } catch (e) {}
      var bytes = raw.length * 2;
      var limit = 5 * 1024 * 1024;
      return {
        bytes: bytes,
        limit: limit,
        percent: Math.min(100, Math.round((bytes / limit) * 100)),
        text: bytes > 1024 * 1024
          ? (bytes / 1024 / 1024).toFixed(2) + " МБ"
          : Math.round(bytes / 1024) + " КБ"
      };
    },

    // фото и видео одним списком: сначала фото, затем видео
    newVideoId: newVideoId,
    putVideo: putVideo,
    getVideo: getVideo,
    deleteVideo: deleteVideo,
    inlineVideos: inlineVideos,
    absorbVideos: absorbVideos,
    cleanupVideos: cleanupVideos,
    estimate: estimate,

    // Адрес медиафайла для тегов img/video
    mediaUrl: mediaUrl,

    // idb:... — старое видео из памяти браузера (оставлено для совместимости),
    // всё остальное — ключ в S3 или прямая ссылка
    resolveVideo: function (src, done) {
      if (typeof src !== "string" || !src) { done(""); return; }
      if (src.indexOf("idb:") === 0) {
        getVideo(src, function (value) { done(value || ""); });
        return;
      }
      done(mediaUrl(src));
    },

    // фото и видео одним списком
    mediaList: function (product) {
      var out = [];
      if (!product) return out;
      (product.images || []).forEach(function (src) {
        out.push({ type: "image", src: src, poster: "" });
      });
      (product.videos || []).forEach(function (v) {
        if (v && v.src) out.push({ type: "video", src: v.src, poster: v.poster || "" });
      });
      return out;
    },

    productById: function (data, id) {
      for (var i = 0; i < data.products.length; i++) {
        if (data.products[i].id === id) return data.products[i];
      }
      return null;
    },

    categoryTitle: function (data, slug) {
      for (var i = 0; i < data.categories.length; i++) {
        if (data.categories[i].slug === slug) return data.categories[i].title;
      }
      return "";
    }
  };

  global.FreyaData = Data;
})(window);
