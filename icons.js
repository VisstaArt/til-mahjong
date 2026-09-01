// Существительные и глаголы — готовые иллюстрации (сгенерированы через API, лежат в assets/icons/).
// Прилагательные-цвета не используют картинку — плитка целиком закрашена цветом (см. COLOR_WORDS).
// Прилагательные-сравнения (büyük/küçük) — тоже иллюстрация: два предмета, один яркий, один серый.

const IMAGE_FILES = {
  kitap: "assets/icons/kitap.jpg",
  "çay": "assets/icons/cay.jpg",
  ekmek: "assets/icons/ekmek.svg",
  su: "assets/icons/su.jpg",
  ev: "assets/icons/ev.svg",
  araba: "assets/icons/araba.jpg",
  kedi: "assets/icons/kedi.svg",
  "köpek": "assets/icons/kopek.svg",
  "güneş": "assets/icons/gunes.svg",
  ay: "assets/icons/ay.jpg",
  "koşmak": "assets/icons/kosmak.jpg",
  "yüzmek": "assets/icons/yuzmek.jpg",
  okumak: "assets/icons/okumak.jpg",
  yazmak: "assets/icons/yazmak.jpg",
  uyumak: "assets/icons/uyumak.jpg",
  "yürümek": "assets/icons/yurumek.jpg",
  "büyük": "assets/icons/buyuk.jpg",
  "küçük": "assets/icons/kucuk.jpg",
};

// Прилагательные-цвета (тема "Цвета") не рисуются картинкой — плитка просто
// заливается этим цветом. Слова вроде "boya"/"karton"/"renk" сюда не входят —
// это не сами цвета, а предметы/понятие, им генерация всё же нужна.
const COLOR_WORDS = {
  "kırmızı": "#e63946",
  mavi: "#2a6fdb",
  kara: "#1a1a1a",
  siyah: "#1a1a1a",
  beyaz: "#ffffff",
  "yeşil": "#2ecc71",
  "sarı": "#f4d03f",
  turuncu: "#e67e22",
  mor: "#8e44ad",
  pembe: "#f78fb3",
  gri: "#95a5a6",
  "açık mavi": "#85c1e9",
  "koyu yeşil": "#1e6b3a",
  "altın": "#d4af37",
  kahverengi: "#8b5a2b",
};

// Числительные (тема "Числительные") не рисуются картинкой — плитка показывает
// само число крупным текстом. Не все слова темы — числа (kaç/tane/paket/litre — это
// не числа, а вопросы/единицы счёта), для них числового представления нет.
const NUMBER_VALUES = {
  "sıfır": "0",
  bir: "1",
  iki: "2",
  "üç": "3",
  "dört": "4",
  "beş": "5",
  "altı": "6",
  yedi: "7",
  sekiz: "8",
  dokuz: "9",
  on: "10",
  yirmi: "20",
  otuz: "30",
  "kırk": "40",
  elli: "50",
  "altmış": "60",
  "yetmiş": "70",
  seksen: "80",
  doksan: "90",
  "yüz": "100",
  bin: "1000",
  milyon: "1 000 000",
  birinci: "1-й",
  ikinci: "2-й",
  "üçüncü": "3-й",
  "dördüncü": "4-й",
  "beşinci": "5-й",
  "altıncı": "6-й",
  yedinci: "7-й",
  sekizinci: "8-й",
  dokuzuncu: "9-й",
  onuncu: "10-й",
};
