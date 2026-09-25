# ApexRadar Düzeltme Yol Haritası

Bu belge **sadece plan**. Kod henüz değişmeyecek. Onayından sonra maddeler sırayla uygulanır.

**Dokunulmayanlar:** Binance sinyal motoru, cascade kuralları, MEXC’de işlem açma mantığı (long/short, TP/SL oranları, 10x), Telegram’a sinyal gönderme.

**Fiyat gerçeği (tek doğru):** İlk ay **$9.99**, sonraki aylar **$14.99**. README ve diğer metinler buna çekilecek; $29 kalkacak.

---

## Sıra ve neden

| Sıra | Madde | Sen ne görürsün? | Risk |
| ---: | --- | --- | --- |
| 1 | Kapı kilidi (`/auth`) | Rastgele e-posta ile VIP linki alınamaz | Üye çalınması |
| 2 | Whop imza kilidi | Sahte “ödedim / iptal” işe yamaz | Sahte üyelik / haksız kick |
| 3 | Yanlış sohbet yasağı | Ayar yoksa bot durur, yanlış yere yazmaz | Mesaj sızıntısı |
| 4 | `/debug` sadece sen | Başkası kanal numarasını göremez | Bilgi sızıntısı |
| 5 | Gerçek işlem kırmızı düğme | İstersen sinyal açık, para kapalı | İstemeden işlem |
| 6 | Telegram yazı düzeltmesi | Yıldızlı bozuk metin düzelir | Görünüm |
| 7 | Fiyat + sağlık sayfası | $9.99 / $14.99; kopuksa “CONNECTED” yalanı biter | Yanlış pazarlama / yanlış sağlık |

---

## Madde 1 — Kapı kilidi (`/auth`)

**Sorun:** Biri `/auth ali@gmail.com` yazınca sistem “bu e-posta VIP mi?” diye bakıyor. E-postayı bilen, o kişinin Telegram’ına bağlanıp davet linkini alabilir.

**Yol:**

1. `/auth e-posta` kalkmaz; yanına **Whop’tan gelen üyelik kodu / membership id** istenir (veya botun ürettiği tek kullanımlık kod).
2. Eşleşme: e-posta **ve** o koda ait aktif kayıt Mongo’da duruyorsa Telegram ID bağlanır.
3. Davet linki ancak o zaman gönderilir.
4. Aynı e-posta başka Telegram’dan tekrar bağlanmaya çalışırsa reddedilir (veya sadece sen `/admin` ile çözersin — uygulama anında netleştirilir).

**Bitti sayılır:** E-posta tek başına VIP açmaz. Sen kendi hesabınla hâlâ girebilirsin.

---

## Madde 2 — Whop imza kilidi

**Sorun:** Gizli anahtar (`WHOP_WEBHOOK_SECRET`) yoksa sistem gelen her POST’a “tamam, Whop bu” diyebilir. Anahtar varken bile imza uzunluğu uymazsa bot o isteği patlatabilir.

**Yol:**

1. Production’da secret **zorunlu**. Yoksa webhook **401** (red). “Geliştirme için açık kapı” kalkar; local’de ayrı bir `ALLOW_INSECURE_WHOP=true` olursa sadece senin makinede açılır.
2. İmza kontrolü: uzunluklar farklıysa exception yerine **red**.
3. Gövde boyutu sınırlı (ör. 100 KB) — saçma büyük istek belleği şişirmez.

**Bitti sayılır:** Whop Dashboard’daki gerçek webhook çalışır. Postman’den imzasız “yeni üye” işe yamaz.

---

## Madde 3 — Yanlış yere mesaj yasağı

**Sorun:** VIP kanal ID, senin chat ID’n, davet linki kodun içine gömülü. Render’da env unutulursa mesaj o gömülü yere gider.

**Yol:**

1. `config.js` içindeki sabit ID/link **silinir**. Hepsi env’den gelir.
2. Bot açılışta şunları kontrol eder: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`, `TELEGRAM_ADMIN_CHAT_ID`, `MONGO_URI`. Real işlem açıksa ayrıca `MEXC_API_KEY` / `MEXC_API_SECRET`.
3. Eksikse process **çıkar** (Render kırmızı görür, sen fark edersin). Sessizce yanlış kanala yazmaz.
4. `.env.example` ve `render.yaml` aynı listeyi gösterir (değerler `sync: false` — secret GitHub’a yazılmaz).

**Bitti sayılır:** Env eksikken bot ayağa kalkmaz. Dolu env ile bugünkü gibi çalışır.

---

## Madde 4 — `/debug` sadece admin

**Sorun:** Herkes `/debug` yazınca VIP/Free kanal ID görünür.

**Yol:**

1. Komut sadece `TELEGRAM_ADMIN_CHAT_ID` ile eşleşen sohbette cevap verir.
2. Başkasına ya cevap yok ya da “yetkin yok”.
3. Token’ın kendisi asla yazılmaz (zaten tam basılmıyor; öyle kalır).

**Bitti sayılır:** Sen `/debug` görürsün, üye göremez.

---

## Madde 5 — Gerçek işlem kırmızı düğme

**Sorun:** MEXC anahtarı env’de varsa bot cascade’de **otomatik gerçek emir** açar. Bunu kapatmanın tek yolu anahtarı silmek; o da kurtarma/pozisyon takibini de körler.

**Yol:**

1. Yeni env: `REAL_TRADING_ENABLED=true|false` (varsayılan **false** — sen Render’da `true` yapmadıkça para işlemez).
2. `false` iken: Telegram sinyali + paper (gölge) bot **açık**. MEXC market emir **yok**.
3. `true` iken: bugünkü RealTrader aynı kalır (emir, native SL/TP, 5 dk, restart’ta pozisyon kurtarma).
4. Açılışta Telegram’dan sana tek satır: “Gerçek işlem: AÇIK” veya “KAPALI”.
5. İsteğe bağlı (aynı maddede küçük): Telegram’dan sadece senin `/real on` `/real off` — Mongo’ya yazılır, Render restart’ta env + kayıt birlikte okunur. İlk teslimde en azından env bayrağı yeterli.

**Bitti sayılır:** Sinyal bozulmaz. Sen düğmeyi açmadan yeni gerçek emir gitmez.

---

## Madde 6 — Telegram yazı düzeltmesi

**Sorun:** Mesajlar HTML bekliyor (`<b>`), bazı komutlar Markdown yıldızı (`*metin*`) kullanıyor. Telegram ya yıldız basar ya mesajı düşürür.

**Yol:**

1. Tüm kullanıcıya giden metin tek format: **HTML**.
2. `/start`, `/plans`, `/status`, paper “shadow” metinleri `<b>` / `<code>` olur.
3. Canlı sinyal formatı zaten HTML; ona dokunulmaz (gerekmezse).

**Bitti sayılır:** Komut cevapları düzgün kalın/kod görünür.

---

## Madde 7 — Fiyat + sağlık sayfası (doğru rakam)

**Doğru fiyat:** İlk ay **$9.99**, sonrası **$14.99**.

**Yol:**

1. `README.md` içindeki $29 / 70 abone / $2000 hikâyesi bu fiyata göre düzeltilir (veya “hedef” diye ayrı tutulur; **satış fiyatı** olarak $29 yazılmaz).
2. `config.js` `priceUsd` ve bot `/plans` aynı iki kademe: ilk ay 9.99, sonra 14.99.
3. Ücretsiz kanal CTA’sı aynı rakamları kullanır.
4. Ana sayfa (`/` HTML): WebSocket gerçekten bağlıysa yeşil CONNECTED; kopuksa kırmızı DISCONNECTED. Uptime ve min alert aynı kalır.
5. `/health` JSON zaten `wsConnected` basıyor; HTML onunla hizalanır.

**Bitti sayılır:** Dışarıya tek fiyat hikâyesi çıkar. Tarayıcıda kopuk bot “sistemler live” yalanı söylemez.

---

## Uygulama sırası (onay sonrası)

```
Gün 1  → Madde 2 + 3     (kilit + yanlış sohbet)  — en az görünür, en çok koruma
Gün 1  → Madde 4 + 6     (debug + yazı)           — küçük, güvenli
Gün 1  → Madde 7         (fiyat + health HTML)
Gün 2  → Madde 1         (/auth güçlendirme)      — üye giriş akışı değişir, dikkat
Gün 2  → Madde 5         (kırmızı düğme)          — Render’da REAL_TRADING_ENABLED=true
                                                      sen yazmadan gerçek emir durur
```

Madde 5’i deploy ederken Render’da **önce** `REAL_TRADING_ENABLED=true` eklemezsen, o deploy’dan sonra gerçek emir **kesilir**. Bunu birlikte işaretleyeceğiz.

---

## Test (her madde sonrası, senin gözün)

- Telegram VIP/Free sinyal hâlâ geliyor mu?
- Paper gölge mesajı sana geliyor mu?
- Madde 5 `true` iken MEXC’de küçük test emri (isteğe bağlı, senin onayınla).
- Madde 5 `false` iken cascade olsa bile MEXC’de **yeni** emir yok mu?
- `/auth` yanlış e-posta / eksik kod → reddediliyor mu?
- İmzası bozuk webhook → 401 mi?
- Env’siz local açılış → bot duruyor mu?
- `/debug` başka hesap → yetkisiz mi?
- `/` sayfası WS kopunca DISCONNECTED mu?
- `/plans` → $9.99 sonra $14.99 mu?

---

## Bilerek yapılmayacaklar

- Cascade eşiği, coin listesi, TP/SL yüzdeleri, kaldıraç
- “Daha çok kazansın diye” strateji değişikliği
- Yapay zeka modeli eğitimi
- GitHub’a secret commit
- Senin istemediğin git commit / push

---

## Onay kutusu

Kod yazımı için ayrı mesajın yeterli: örneğin **“yol haritasını uygula”** veya **“sadece 2, 3, 5 yap”**.

Bu dosya planın kendisidir; bu adımda başka dosya değiştirilmedi.
