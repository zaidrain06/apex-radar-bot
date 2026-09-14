# ⚡ ApexRadar: Crypto Whale & Liquidation Intelligence Bot
### *Autonomous Recurring Revenue Engine (VNT-003)*

ApexRadar is a high-frequency cryptocurrency derivatives intelligence engine that monitors real-time institutional liquidation cascades, whale order flow, and leverage squeezes across Binance Futures.

Designed for automated monetization through **Whop.com** ($29/month subscriptions) with zero PayPal dependency and direct Turkish bank IBAN or USDT payouts.

---

## 🎯 Revenue Economics ($1 = ~48 TRY)

- **Subscription Price:** $29 / month
- **Target Net Monthly:** **$2,000 / month**
- **Subscribers Needed:** **Only 70 Active Subscribers**
- **Monthly TRY Cash Flow:** **~96,000 TL / month**
- **Operating Margin:** > 97% (free public WebSockets, low-cost Render/Railway cloud hosting)

---

## 🏗️ Architecture

```
                               ┌────────────────────────┐
                               │ Binance Futures WS     │
                               │ (!forceOrder@arr)      │
                               └───────────┬────────────┘
                                           │ Real-time order flow
                                           ▼
                               ┌────────────────────────┐
                               │  BinanceStreamEngine   │
                               │  - Filter >= $25k      │
                               │  - Mega >= $150k       │
                               │  - Cascade Detector    │
                               └───────────┬────────────┘
                                           │ Emits Events
                                           ▼
                               ┌────────────────────────┐
                               │   Signal Formatter     │
                               │   Institutional MD     │
                               └───────────┬────────────┘
                                           │
                    ┌──────────────────────┴──────────────────────┐
                    ▼                                             ▼
       ┌────────────────────────┐                    ┌────────────────────────┐
       │   Telegram Manager     │                    │       Whop Gate        │
       │   - Broadcast VIP Chat │                    │   - Webhook validation │
       │   - User Commands      │                    │   - Member paywall     │
       └────────────────────────┘                    └────────────────────────┘
```

---

## 🚀 Quick Start

### 1. Installation
```bash
npm install
```

### 2. Test Simulation (Verify Signal Output)
```bash
node test_simulation.js
```

### 3. Run Live Service
```bash
node src/index.js
```

### 4. Healthcheck
```bash
curl http://localhost:3000/health
```

---

## ⚙️ Configuration (.env)

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | Webhook & healthcheck port | `3000` |
| `MIN_LIQUIDATION_USD` | Minimum USD to broadcast alert | `25000` |
| `MEGA_LIQUIDATION_USD` | Trigger for Mega Whale alert | `150000` |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | — |
| `TELEGRAM_CHANNEL_ID` | VIP Telegram channel or group | — |
| `WHOP_API_KEY` | Whop developer API key | — |
| `WHOP_WEBHOOK_SECRET` | Whop webhook signature secret | — |

---

## 📦 Deployment

Deploy directly via Docker to Render.com, Railway, or VPS.
Healthcheck endpoint: `/health`
Whop webhook endpoint: `/webhooks/whop`
