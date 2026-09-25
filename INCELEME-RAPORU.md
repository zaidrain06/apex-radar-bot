# ApexRadar — Bağımsız Kod İnceleme Raporu

> Bu belge, projenin **iki bağımsız AI incelemesi** (Kiro + Cursor) sonucunda tespit edilen bulguların birleştirilmesidir.  
> Amaç: Projeyi yapan ekibe "dışarıdan gözler ne gördü" sorusunun eksiksiz cevabını vermek.

---

## Genel Değerlendirme

Proje fikir olarak güçlü ve teknik temeli doğru kurulmuş. Binance WebSocket veri akışı, EventEmitter mimarisi, MongoDB ile durum kalıcılığı ve Whop webhook entegrasyonu birlikte iyi çalışıyor. Ticari mantık (ücretsiz kanal → ücretli kanal hunisi, Whop ile otomatik kick) doğru düşünülmüş.

Bununla birlikte; güvenlik açıkları, yapılandırma eksiklikleri ve kod kalitesi sorunları canlıya çıkmadan düzeltilmesi gereken bir liste oluşturuyor. Aşağıda her bulgu **seviye** ve **kaynak** ile işaretlenmiştir.

| Seviye | Renk | Anlam |
|---|---|---|
| KRİTİK | 🔴 | Canlıda aktif risk, hemen düzeltilmeli |
| ÖNEMLİ | 🟡 | Kararlılığı veya güvenliği etkiliyor |
| KÜÇÜK | 🟢 | Kod kalitesi / görünüm |

| Kaynak | |
|---|---|
| `[K]` | Kiro tarafından tespit edildi |
| `[C]` | Cursor tarafından tespit edildi |
| `[K+C]` | Her ikisi de tespit etti |

---

## 🔴 KRİTİK Bulgular

### 1. Whop Webhook İmzası Bypass Edilebiliyor `[K+C]`

**Dosya:** `src/whop/whopGate.js` — `verifyWebhook()`

**Sorun:**
```js
verifyWebhook(rawBody, signatureHeader) {
  if (!this.webhookSecret) return true; // ← HER ZAMAN GEÇER
  ...
}
```
`WHOP_WEBHOOK_SECRET` ortam değişkeni tanımlanmamışsa, dışarıdan gelen her POST isteği otomatik olarak doğrulanmış sayılıyor. Bu, herhangi birinin `POST /webhooks/whop` adresine sahte bir "üyelik aktif" veya "üyelik iptal" mesajı göndererek kanalı manipüle edebileceği anlamına gelir.

**Ek risk:** Gövde boyutuna sınır yok. Büyük payload ile bellek şişirilebilir.

**Beklenen düzeltme:**
- Production'da secret yoksa webhook `401` döndürmeli, sessizce geçmemeli.
- Gerekirse `ALLOW_INSECURE_WHOP=true` gibi açık bir bayrak ile sadece yerel geliştirmeye izin verilmeli.
- Request body 100 KB ile sınırlanmalı.

---

### 2. `/auth` Komutu E-posta Tek Başına Yeterli `[C]` *(Kiro not olarak işaretlemişti)*

**Dosya:** `src/bot/telegramManager.js` — `/auth` handler

**Sorun:**  
Kullanıcı `/auth baskasinin@email.com` yazarsa, o e-postanın sahibinin Whop üyeliği varsa VIP davet linki gönderiliyor. E-postayı bilen herkes başka bir kişinin üyeliğini "çalabilir."

**Saldırı senaryosu:**  
Whop'ta satın almış bir kullanıcının e-postasını bilmek → Telegram'a `/auth o@email.com` yazmak → VIP davet linkini almak → ücretsiz erişim.

**Beklenen düzeltme:**  
E-posta tek başına yetmemeli. Ek bir doğrulama faktörü gerekli:
- Whop'tan gelen membership ID veya
- Bot'un ürettiği tek kullanımlık kod (Whop webhook geldiğinde MongoDB'ye kaydedilir, kullanıcı bu kodu bota yazar)
- Aynı e-posta ikinci bir Telegram hesabından bağlanmaya çalışırsa reddedilmeli.

---

### 3. Hardcode Edilmiş Kanal ve Admin ID'leri `[K+C]`

**Dosya:** `src/config.js`

**Sorun:**
```js
channelId: (process.env.TELEGRAM_CHANNEL_ID && ...) 
  ? process.env.TELEGRAM_CHANNEL_ID 
  : '-1004208031753',  // ← gerçek kanal ID
adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID || '1339587201', // ← gerçek kişisel ID
inviteLink: process.env.TELEGRAM_INVITE_LINK || 'https://t.me/+7olzpqcRqMthNmM0',
```

Render'a deploy edilirken bir env değişkeni atlanırsa sistem hata vermez — sessizce bu gömülü değerlere mesaj gönderir. Davet linki, kanal numarası ve kişisel chat ID kaynak kodunda açık duruyor.

**Beklenen düzeltme:**
- Fallback değerler kaldırılmalı.
- Bot açılışta `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`, `TELEGRAM_ADMIN_CHAT_ID`, `MONGO_URI` yoksa `process.exit(1)` ile durmalı.
- Render'da env eksikse kırmızı alarm görünmeli; yanlış kanala yazmak yerine hiç yazmamalı.

---

### 4. `.dockerignore` Dosyası Yok — `.env` Image'a Gömülebilir `[K]`

**Dosya:** `Dockerfile`

**Sorun:**
```dockerfile
COPY . .  # ← .env, test_*.js, .git, patch_*.js hepsini kopyalar
```
Eğer proje dizininde `.env` dosyası varken `docker build` çalıştırılırsa, API anahtarları, bot token ve MongoDB URI Docker image'ın içine gömülür. Bu image bir registry'ye (Docker Hub, GHCR, Render) push edilirse secretlar sızar.

**Beklenen düzeltme — `.dockerignore` oluşturulmalı:**
```
.git
.env
node_modules
shadow_state.json
test_*.js
fix_trailing.js
patch_retry.js
patch_ac.js
*.md
```

---

### 5. `render.yaml`'da Kritik Env Değişkenleri Eksik `[K]`

**Dosya:** `render.yaml`

**Sorun:**  
Mevcut manifest'te şu değişkenler tanımlı değil:

| Eksik Değişken | Etkisi |
|---|---|
| `MONGO_URI` | MongoDB bağlantısı yok → tüm durum in-memory, restart'ta sıfırlanır |
| `WHOP_API_KEY` | Whop API çağrıları çalışmaz |
| `WHOP_WEBHOOK_SECRET` | Yukarıdaki bypass açığı aktif kalır |
| `MEXC_API_KEY` / `MEXC_API_SECRET` | RealTrader çalışmaz ama sessizce |
| `TELEGRAM_FREE_CHANNEL_ID` | Ücretsiz kanal yayınları devre dışı |
| `TELEGRAM_INVITE_LINK` | Hardcode link kullanılır |

**Beklenen düzeltme:**  
Tüm değişkenler `sync: false` ile eklenmeli (değer GitHub'a yazılmaz, Render Dashboard'dan girilir).

---

## 🟡 ÖNEMLİ Bulgular

### 6. Gerçek İşlem İçin "Kırmızı Düğme" Yok `[C]`

**Dosya:** `src/engine/realTrader.js`, `src/index.js`

**Sorun:**  
`MEXC_API_KEY` env'de tanımlıysa, her cascade sinyalinde **otomatik olarak gerçek para ile işlem açılır.** Bunu durdurmanın tek yolu API anahtarını silmek — bu da pozisyon kurtarma özelliğini de devre dışı bırakır.

**Beklenen düzeltme:**
- `REAL_TRADING_ENABLED=true|false` ortam değişkeni (varsayılan: `false`)
- `false` iken sinyal + paper bot çalışır, MEXC'e emir gitmez.
- Bot açılışta Telegram'dan admin'e tek satır durum mesajı: `"Gerçek işlem: AÇIK ✅"` veya `"Gerçek işlem: KAPALI 🔒"`

---

### 7. `timeoutId` Closure Sırası Riski `[K]`

**Dosya:** `src/engine/realTrader.js` — `executeTrade()` içi

**Sorun:**
```js
const monitorInterval = setInterval(async () => {
  // ...
  clearTimeout(timeoutId);  // ← timeoutId henüz undefined!
}, 5000);

// ... (50+ satır sonra)
const timeoutId = setTimeout(() => { ... }, 300000);
```
`setInterval` callback'i `timeoutId` tanımlanmadan önce ilk kez tetiklenirse `clearTimeout(undefined)` çağrılır. Bu JavaScript'te hata vermez ama `timeoutId` iptal edilmez — timeout ve pozisyon aynı anda kapanmaya çalışabilir. `isClosing` bayrağı bunu genellikle yakalar ama tasarımsal olarak kırılgan.

---

### 8. `/debug` Komutu Herkese Açık `[K+C]`

**Dosya:** `src/bot/telegramManager.js`

**Sorun:**  
Herhangi bir Telegram kullanıcısı `/debug` yazarak VIP kanal ID ve ücretsiz kanal ID'yi görebilir.

**Beklenen düzeltme:**  
Komut yalnızca `TELEGRAM_ADMIN_CHAT_ID` ile eşleşen kullanıcıya cevap vermeli. Diğerlerine ya hiç cevap yok ya da "yetki yok."

---

### 9. `reset_db.js` Yanlış Tip Kullanıyor `[K]`

**Dosya:** `reset_db.js`

**Sorun:**
```js
await BotState.updateOne({ type: 'PAPER' }, ...)  // ← canlı kod 'PAPER_V2' kullanıyor
```
Script çalıştırıldığında gerçek `PAPER_V2` dokümanına hiç dokunmaz. Bunun yerine `type: 'PAPER'` adında phantom bir doküman oluşturur. Paper bot bakiyesi sıfırlanmaz.

---

### 10. Telegram Format Karışıklığı: HTML vs Markdown `[C]`

**Dosya:** `src/bot/telegramManager.js` — komut cevapları

**Sorun:**  
Sinyal formatter'lar `parse_mode: 'HTML'` kullanıyor (`<b>`, `<code>` tag'leri). Ama `/start`, `/plans`, `/status` gibi komut cevapları hâlâ Markdown yıldızı (`*metin*`, `\`kod\``) kullanıyor. Telegram bu iki formatı aynı anda desteklemiyor — `HTML` modunda `*metin*` yıldız olarak basılır, bold olmaz.

**Beklenen düzeltme:**  
Tüm `sendMessage` çağrıları tek formata (HTML) geçmeli.

---

### 11. README'de Yanlış Abonelik Fiyatı `[C]`

**Dosya:** `README.md`, `src/formatters/signalFormatter.js`, `src/bot/telegramManager.js`

**Sorun:**  
README $29/ay abonelikten bahsediyor. Gerçek fiyat: **ilk ay $9.99, sonraki aylar $14.99**. Bot'un `/plans` komutu da bu tutarsızlığı yansıtıyor.

Dışarıdan bakan biri (yatırımcı, iş ortağı, yeni geliştirici) yanlış ekonomik modeli okur.

---

### 12. Health Page WebSocket Durumunu Yanlış Gösteriyor `[C]`

**Dosya:** `src/index.js` — HTML healthcheck

**Sorun:**
```html
<span class="metric-val" style="color:#10b981;">CONNECTED</span>
```
Bu değer hardcode — WebSocket gerçekte kopuk olsa bile "CONNECTED" yazar.

**Beklenen düzeltme:**  
`/health` JSON endpoint'i zaten `wsConnected: binanceEngine.isConnected` basıyor. HTML sayfası bu değeri okumalı.

---

## 🟢 KÜÇÜK Bulgular

### 13. Ölü Bağımlılık: `node-telegram-bot-api` `[K]`

**Dosya:** `package.json`

Paket kurulu ama kodun hiçbir yerinde kullanılmıyor. Tüm Telegram çağrıları native `fetch` ile yapılıyor. Bu paket Docker image'ı gereksiz ~2MB şişiriyor ve bağımlılık güvenlik taramasında gürültü yaratıyor.

**Düzeltme:** `npm uninstall node-telegram-bot-api`

---

### 14. Tehlikeli Patch Scriptleri Repoda Duruyor `[K]`

**Dosyalar:** `fix_trailing.js`, `patch_retry.js`, `patch_ac.js`

Bu scriptler kaynak dosyaları metin replace ile değiştiren one-shot migration araçlarıdır. Zaten uygulanmış değişiklikler bunlar. Yanlışlıkla tekrar çalıştırılırsa `realTrader.js` ve `paperTrader.js` bozulabilir.

**Düzeltme:** Arşive alınmalı veya silinmeli.

---

### 15. Orphan Dosyalar `[K]`

| Dosya | Sorun |
|---|---|
| `shadow_state.json` | Pre-MongoDB dönemden kalma. `{"balance": 11000, "winCount": 1, ...}`. Hiçbir kod okumuyor. |
| `src/whop/db.json` | Boş `{}`. Eski dosya tabanlı DB konseptinin kalıntısı. |

---

### 16. PaperTrader ve RealTrader %80 Aynı Kod `[K]`

**Dosyalar:** `src/engine/paperTrader.js`, `src/engine/realTrader.js`

Circuit breaker, BTC trend filtresi, SL/TP hesaplama, ML dataset kaydetme mantığı iki dosyada kopyalanmış. Gelecekte bir değişiklik yapılırsa ikisine birden uygulanması gerekiyor — unutulursa botlar farklı davranmaya başlar.

**Öneri:** `BaseTrader` sınıfı, PaperTrader ve RealTrader bu sınıftan extend eder.

---

### 17. `.env.example`'da Eksik Değişkenler `[K]`

**Dosya:** `.env.example`

Aşağıdaki değişkenler `.env.example`'da belgelenmemiş:

| Eksik | Nerede Kullanılıyor |
|---|---|
| `MONGO_URI` | `src/index.js` — MongoDB bağlantısı |
| `MEXC_API_KEY` | `src/engine/realTrader.js` — Gerçek işlemler |
| `MEXC_API_SECRET` | `src/engine/realTrader.js` — Gerçek işlemler |

Projeyi klonlayan biri MongoDB bağlantısı olmadan neden işlemler kalıcı değil anlayamaz.

---

## Özet: Bulgu Sayısı ve Dağılımı

| Seviye | Adet | Madde No |
|---|---|---|
| 🔴 KRİTİK | 5 | 1, 2, 3, 4, 5 |
| 🟡 ÖNEMLİ | 8 | 6, 7, 8, 9, 10, 11, 12, 17 |
| 🟢 KÜÇÜK | 4 | 13, 14, 15, 16 |
| **TOPLAM** | **17** | |

---

## Önerilen Uygulama Sırası

Cursor'ın yol haritasına ek olarak aşağıdaki sıralama hem güvenliği hem üretim kararlılığını önceliklendirir:

```
GÜN 1 — Güvenlik & Yapılandırma
  [4]  .dockerignore oluştur
  [5]  render.yaml'ı tamamla (MONGO_URI, WHOP_*, MEXC_*, FREE_CHANNEL)
  [2]  Webhook secret bypass kaldır → 401
  [3]  config.js hardcode fallback'leri temizle → açılışta exit(1)
  [8]  /debug komutu admin-only yap
  [13] node-telegram-bot-api bağımlılığını kaldır
  [17] .env.example'ı tamamla

GÜN 2 — Güvenlik & Kullanıcı Akışı
  [1]  /auth'u güçlendir (membership ID veya tek kullanımlık kod)
  [6]  REAL_TRADING_ENABLED bayrağı ekle
  [10] HTML/Markdown format tutarlılığı

GÜN 3 — Doğruluk & Temizlik
  [11] README ve /plans fiyat düzeltmesi ($9.99 / $14.99)
  [12] Health page WebSocket durumu dinamik hale getir
  [9]  reset_db.js tip hatası düzelt
  [14] Patch scriptleri sil / arşivle
  [15] Orphan dosyaları temizle
  [7]  timeoutId closure sırasını refactor et
```

---

## Dokunulmaması Gerekenler

İki inceleme de aşağıdakilerin **olduğu gibi kalması** gerektiğini vurguluyor:

- Binance WebSocket bağlantısı ve yeniden bağlanma mantığı
- Cascade algoritması (15 saniye pencere, 3 likidisyon, $25k eşik, 60 saniye cooldown)
- MEXC işlem yönü (long cascade → buy, short cascade → sell)
- SL %2 / TP %1.5 major / TP %4 altcoin oranları
- 10x kaldıraç
- Consecutive loss circuit breaker (günlük 3 ardışık zarar)
- Telegram sinyal formatı (VIP mesajları zaten HTML ve iyi görünüyor)

---

## Not

Bu rapor yalnızca statik kod analizi ve mimari değerlendirmeden oluşmaktadır. Hiçbir değişiklik yapılmamıştır. Uygulama için ayrı onay gereklidir.
