# Global Lucky Cash

[English](#english) ・ [繁體中文](#繁體中文)

---

## English

A fully decentralized lottery built on Bitcoin Cash (CashScript + CashTokens). This repo publishes two things so anyone can verify the system's fairness:

- `contracts/`: the complete on-chain contract source (CashScript)
- `frontend/`: the exact front-end source (Vue 3) that powers the official site — the same interface players use to buy tickets, trigger drawings, and verify results

For the full system design, fund flow, randomness source, and security assumptions, see [`docs/whitepaper_en.md`](docs/whitepaper_en.md)（[繁體中文版](docs/whitepaper.md)）.

### What This Repo Lets You Do

Run `frontend/` as-is on your own machine and you'll get an interface identical to the official site — because it talks to **the exact same set of already-deployed on-chain contracts** (the same ticket pool, the same jackpot pool, the same NFTs). In other words, a ticket you buy and the TicketNFT you receive on your own self-hosted copy are the same thing as buying directly on the official site, so you can use it to check whether the official site's behavior actually matches the publicly readable contract logic.

This repo doesn't include the contract deployment (genesis) scripts, because the point of verification isn't "spin up your own separate set of contracts" — it's "does what the official site shows match this public source code and the real on-chain state."

### Running the Front End Locally

Requires Node.js 20+.

```bash
npm install
npm run dev
```

By default this connects to chipnet (testnet); the corresponding contract category IDs live in [`frontend/.env.development`](frontend/.env.development), matching the current public test site.

#### Chipnet Contract & Oracle IDs

These are constructor parameters baked into the deployed contracts' locking bytecode. To reproduce the same contract instances (and therefore the same contract addresses) as the official test site, you must instantiate the contracts with these exact values — they're already set in `.env.development` / `.env.staging`, listed here for reference:

| Env var | Value |
| --- | --- |
| `VITE_AUTH_NFT_CATEGORY_ID` | `eccbc8626b3b022a378d51c38248b68276556fa0639c0ba4b386f31be9340600` |
| `VITE_ADMIN_NFT_CATEGORY_ID` | `9090b4059fab99d9958ffda7977ee04b17e623784147012160998d5da7c236e1` |
| `VITE_ORACLE_PUB` (BCHUSD price oracle) | `02d09db08af1ff4e8453919cc866a4be427d7bfe18f2c05e5444c196fcf6fd2818` |

#### WalletConnect Project ID

The front end uses [WalletConnect](https://walletconnect.com/) (now Reown) so you can scan a QR code with a supported wallet app to connect and sign transactions. The `VITE_WALLETCONNECT_PROJECT_ID` in `frontend/.env.development` is just a placeholder — swap in your own before it'll actually connect:

1. Sign up for free at [cloud.reown.com](https://cloud.reown.com/) and create a project
2. Copy the Project ID you're given
3. Paste it into `VITE_WALLETCONNECT_PROJECT_ID` in `frontend/.env.development` (or whichever other `.env.*` file you're running)

#### Other Environment Config Files

- `.env.development`: local development, connects to chipnet
- `.env.staging`: matches the staging site, connects to chipnet
- `.env.production`: matches the production site, connects to mainnet — the contracts haven't been deployed to mainnet yet, so `VITE_AUTH_NFT_CATEGORY_ID` / `VITE_ADMIN_NFT_CATEGORY_ID` are still empty

### Verifying the Contract Source

`artifacts/` holds each contract's compiled artifact (bytecode). To recompile it yourself and check it matches the source:

```bash
npm run compile-all
```

This needs [`cashc`](https://cashscript.org/) installed first (it's already listed in devDependencies, so `npm install` sets it up for you).

---

## 繁體中文

基於 Bitcoin Cash（CashScript + CashTokens）的完全去中心化樂透。本 repo 公開兩部分內容，供任何人驗證系統的公平性：

- `contracts/`：全部鏈上合約原始碼（CashScript）
- `frontend/`：官方網站實際使用的前端原始碼（Vue 3），也就是玩家購票、開獎、驗證的介面本身

詳細的系統設計、資金流、隨機性來源與安全假設，請見 [`docs/whitepaper.md`](docs/whitepaper.md)（[English version](docs/whitepaper_en.md)）。

### 這個 repo 讓你可以做什麼

把 `frontend/` 原封不動架在自己的機器上跑起來，介面會跟官方網站一模一樣——因為連的是**同一組已經部署上鏈的合約**（同一個票池、同一個頭獎池、同一批 NFT）。也就是說，你在自己架的站上買的票、拿到的 TicketNFT，跟直接在官方網站操作是同一回事，可以拿來對照官方網站的行為是否與公開的合約邏輯一致。

這個 repo 不含合約部署（genesis）腳本，因為驗證的重點不是「自己生一組合約」，而是「官方站台呈現的行為，跟這份公開原始碼、跟鏈上實際狀態是否一致」。

### 本機執行前端

需要 Node.js 20+。

```bash
npm install
npm run dev
```

啟動後預設連到 chipnet（測試網），對應的合約 category id 寫在 [`frontend/.env.development`](frontend/.env.development)，與目前正式對外的測試站台相同。

#### Chipnet 合約與 Oracle ID

這些是寫死在已部署合約 locking bytecode 裡的建構子參數。要重現跟正式測試站台相同的合約實例（進而是相同的合約地址），編譯時就必須帶入這幾個值——`.env.development` / `.env.staging` 裡已經設定好了，這裡列出來方便對照：

| 環境變數 | 值 |
| --- | --- |
| `VITE_AUTH_NFT_CATEGORY_ID` | `eccbc8626b3b022a378d51c38248b68276556fa0639c0ba4b386f31be9340600` |
| `VITE_ADMIN_NFT_CATEGORY_ID` | `9090b4059fab99d9958ffda7977ee04b17e623784147012160998d5da7c236e1` |
| `VITE_ORACLE_PUB`（BCHUSD 價格 oracle） | `02d09db08af1ff4e8453919cc866a4be427d7bfe18f2c05e5444c196fcf6fd2818` |

#### WalletConnect Project ID

前端使用 [WalletConnect](https://walletconnect.com/)（現為 Reown）讓你用支援的錢包 App 掃碼連線簽署交易。`frontend/.env.development` 裡的 `VITE_WALLETCONNECT_PROJECT_ID` 是佔位字串，需要換成你自己申請的值才能連線：

1. 到 [cloud.reown.com](https://cloud.reown.com/) 免費註冊、建立一個 Project
2. 複製取得的 Project ID
3. 貼到 `frontend/.env.development`（或你要跑的其他 `.env.*` 檔）的 `VITE_WALLETCONNECT_PROJECT_ID`

#### 其他環境設定檔

- `.env.development`：本機開發，連 chipnet
- `.env.staging`：對應 staging 站台，連 chipnet
- `.env.production`：對應正式站台，連 mainnet——目前合約尚未部署到 mainnet，`VITE_AUTH_NFT_CATEGORY_ID` / `VITE_ADMIN_NFT_CATEGORY_ID` 仍為空值

### 驗證合約原始碼

`artifacts/` 內是各合約編譯後的 artifact（bytecode）。若想自己重新編譯核對是否與原始碼相符：

```bash
npm run compile-all
```

需要先安裝 [`cashc`](https://cashscript.org/)（已列在 devDependencies，`npm install` 會一併裝好）。
