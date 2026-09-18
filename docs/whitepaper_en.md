# GLOBAL LUCKY CASH

## A Fully Decentralized Lottery Built on Bitcoin Cash — Whitepaper

**Version**: v1.0
**Built On**: Bitcoin Cash (BCH), CashTokens, CashScript

> This document assumes the reader already has a working knowledge of blockchain and cryptocurrency concepts (UTXOs, smart contracts, tokens, oracles, and the like).
> Its purpose is to explain Global Lucky Cash's design philosophy, system architecture, economic model, and security assumptions, and to serve as the project's technical and vision statement.
> Nothing in this document is financial advice. Lottery and gambling activities are regulated by law in most jurisdictions — check your local laws before participating.

---

## Table of Contents

1. Executive Summary
2. The Problem: The Trust Gap in Traditional Lotteries and On-Chain Gambling
3. Solution Overview
4. Why Bitcoin Cash
5. Glossary: BCH and CashTokens Basics
6. Game Rules and Prize Design
7. System Architecture: State as UTXOs
8. Round Lifecycle and Fund Flow
9. Randomness and Verifiable Fairness
10. Security Design and Threat Model
11. Walletless Ticket Purchases: Lowering the Barrier to Entry
12. Platform Role and Economic Incentive Design
13. Comparison with Traditional Lotteries and Other On-Chain Gambling
14. Development Status and Scope
15. Risk Disclosure and Disclaimer
16. Closing Remarks

---

## 1. Executive Summary

Global Lucky Cash is a decentralized lottery built entirely on the Bitcoin Cash blockchain. Every dollar, every rule, and every drawing is expressed and enforced on-chain through smart contracts (CashScript) and native tokens (CashTokens NFTs) — there's no centralized database or back-office ledger anywhere in the system. Picking numbers, buying tickets, drawing, verifying wins, handling expirations, claiming prizes — **every step of the process is a public transaction that anyone can trigger**, including the platform itself, which holds no special privileges on-chain.

The whole design boils down to one sentence: **the rules are hard-coded into the contracts, the money is locked into the contract addresses, the drawing results are determined by a publicly verifiable oracle signature, and anyone can push the process forward or verify the outcome. The platform only collects its agreed-upon cut — it can't touch player funds, can't change the rules, and can't shut the game down.**

Beyond giving players a fair, transparent alternative to traditional lotteries, Global Lucky Cash also exists to generate real transaction volume for the Bitcoin Cash network. As the block subsidy keeps shrinking over time, miner revenue has to gradually shift from block rewards toward transaction fees, and on-chain applications that keep generating steady volume are exactly what that transition needs. A lottery — high-frequency, low-value, endlessly repeatable — is a natural fit for feeding BCH a steady stream of fee revenue. That's the other half of why this project exists.

- **Number field**: pick 3 from 32 for the main numbers, plus 1 from 16 for the Bonus Number — **79,360** possible combinations
- **Drawing cycle**: a fixed 3.5-day round (twice a week)
- **Prize fund split**: of each round's ticket sales, **50% goes to the jackpot pool, 30% to the fixed-prize pool, and 20% to the platform**
- **Randomness source**: signed price messages from the [oracles.cash](https://oracles.cash/api-docs/) oracle
- **Walletless purchases supported**: so someone withdrawing straight from an exchange can buy a ticket without ever learning to use an on-chain wallet

---

## 2. The Problem: The Trust Gap in Traditional Lotteries and On-Chain Gambling

Traditional lottery systems ask players to trust the operator on faith:

- **The draw itself is a black box.** Ball machines, computer RNGs — whatever mechanism the operator uses, it's run unilaterally by the operator, and players have no way to independently verify that the result was actually random or wasn't manipulated.
- **Where the money goes is a black box, too.** The prize pool and operating costs sit in the operator's private ledger; the public only ever sees whatever summary figures get published in an official announcement.
- **The rules can change on a whim.** Take rates, prize structures, drawing frequency — in principle the operator can adjust any of it at any time, with no technical guarantee given to players beforehand.
- **Cross-border participation is a hassle.** A local bank account, ID verification, physical retail channels — all of it makes it hard for players outside the home market to participate on equal footing.

Even a lot of "on-chain" gambling projects only move the interface onto the blockchain — the actual number generation and custody of funds are still controlled by a centralized server or a multisig key. Players still have no choice but to "trust" the operator isn't cheating, which isn't really any different from the traditional model.

Global Lucky Cash tries to solve this at the architecture level: **the goal isn't to shift trust from one institution to another — it's to remove the need to trust any single party in the process at all** (with one exception: the randomness source, which we address honestly in Section 9).

---

## 3. Solution Overview

Global Lucky Cash's approach: encode **every piece of state** the lottery needs — the current round, the exchange rate used for ticket sales, how many tickets each number has sold, the drawing result, prize pool balances, and so on — as CashTokens NFTs sitting on on-chain UTXOs, and use CashScript contract rules to dictate exactly how those UTXOs can be spent and rebuilt.

That has a few direct consequences:

- **No back-office database.** All state lives on-chain; anyone can verify it with a block explorer or their own node.
- **No admin switch.** Once a contract is deployed, its logic is locked in. The only privilege the platform retains is withdrawing its own agreed-upon operating share (`adminWithdraw()`) — it can't touch player funds or the prize pools.
- **The process runs on economic incentives, not on the platform staying up.** Settling, aggregating, entering the drawing phase, drawing, and verifying wins are all transactions that carry an **execution reward** — anyone (a player's own script, a third-party keeper, whoever) who executes one of these transactions collects the reward, which keeps the system moving even if the platform's own servers go down.
- **Drawing results can be independently recomputed.** Anyone can take the oracle's public historical messages and recompute, from scratch, the exact same winning numbers the contract produced — no need to take the platform's announcement on faith.

---

## 4. Why Bitcoin Cash

A lottery application has a few specific requirements for its underlying chain, and here's the concrete case for BCH + CashTokens + CashScript:

| Requirement | What BCH Provides |
|---|---|
| **Native tokens/NFTs, no extra token-standard contract needed** | CashTokens are fungible tokens and NFTs supported natively at the BCH protocol layer. Minting, mutability, and locking (capabilities) are guaranteed by the protocol itself — there's no need to deploy a separate ERC-721-style contract just to implement the token logic's own security, the way you would on other chains |
| **UTXOs that can "carry state," protected by contract rules** | Contracts compiled with CashScript support introspection — reading the contents of `tx.inputs[i]` / `tx.outputs[i]` — which turns an NFT commitment sitting on a UTXO into a verifiable, rule-enforced state container. That's the technical foundation for encoding "current round," "tickets sold," and "drawing result" as NFTs |
| **High-frequency, low-value transactions are actually practical** | A lottery needs frequent, small ticket-sale transactions and prize distributions. BCH's low fees and fast confirmations are well suited to that kind of transaction density |
| **An on-chain, verifiable price-oracle ecosystem (oracles.cash)** | The BCH ecosystem already has a standardized, signature-verifiable oracle message format (see Section 9) that can serve directly as an entropy source for randomness — no need to integrate an external randomness service like Chainlink VRF |
| **Room to parallelize under high concurrency** | 79,360 possible number combinations and high-concurrency ticket sales are handled in parallel via "many UTXOs at the same contract address, each distinguished by its own commitment" (see Section 7) — a natural advantage of the UTXO model over the account model: UTXOs for different numbers don't conflict with each other and can be spent by different transactions at the same time |

---

## 5. Glossary: BCH and CashTokens Basics

For readers coming from other chains (Ethereum, say) who may not be familiar with BCH's particular model, here are a few key terms used throughout the rest of this document:

| Term | Explanation |
|---|---|
| **UTXO** | Unspent Transaction Output. BCH inherits Bitcoin's ledger model: assets exist as discrete "outputs," and spending one consumes it entirely and produces new outputs — unlike Ethereum's account-balance model |
| **CashTokens** | BCH's native token standard, launched in 2023. It lets a single UTXO carry a BCH amount, a Token Category (the token's type ID), and an arbitrary data field (the **NFT commitment**) |
| **NFT commitment** | An arbitrary-length data field attached to a CashTokens NFT — essentially "the current state of this NFT." This system uses commitments to store the round number, chosen numbers, tickets sold, prize pool balances, and every other piece of system state |
| **Capability** | CashTokens NFTs come in three modes: `none` (neither the commitment nor the NFT's existence can change — used for a ticket that's already been sold), `mutable` (the commitment can be updated, but no new NFT of that category can be minted), and `minting` (the commitment can be updated and new NFTs of the same category can be minted within the same transaction). The system chooses the right capability for each NFT to precisely control what state can and can't change |
| **Covenant** | A CashScript contract restriction that inspects a transaction's own inputs and outputs (*introspection*) to constrain how a UTXO can be spent and rebuilt — this is the actual mechanism behind "the rules are hard-coded into the contract" |
| **Dust** | The minimum BCH amount a UTXO must hold to remain valid. This system uses a flat 1,000 satoshis throughout |
| **Oracle** | A service that brings off-chain information (like the BCH/USD exchange rate) on-chain with a cryptographic signature so contracts can verify it. This system uses the oracle's signed messages as its source of unpredictable randomness as well (see Section 9) |

---

## 6. Game Rules and Prize Design

### 6.1 Number Selection

- **Main numbers**: pick 3 from 1–32
- **Bonus Number**: pick 1 from 1–16
- **Total combinations**: C(32,3) × 16 = 4,960 × 16 = **79,360**
- **Ticket price**: a fixed USD value converted to BCH at each round's ticket-sale exchange rate (the rate and the price are kept separate; the price is set by the `ticketPriceCents` constructor parameter). The design target is $1, and that's the value currently used in development, testing, and production alike
- A single transaction can buy **1 to 10** different number combinations at once, each minting its own ticket NFT (TicketNFT)

### 6.2 Prize Design

| Winning Condition | Prize | Approximate Odds |
|---|---|---|
| **Jackpot**: all 3 main numbers plus the Bonus Number | An equal share (by ticket count) of the entire current jackpot pool balance (not a fixed amount) | 1 in 79,360 |
| Bonus Number only (no main numbers) | 2× ticket price | 1 in 21.7 |
| 1 main number + the Bonus Number | 5× ticket price | 1 in 65 |
| 2 main numbers + the Bonus Number | 20× ticket price | 1 in 912 |
| 3 main numbers (no Bonus Number) | 100× ticket price | 1 in 5,291 |

Combined, the fixed-prize tiers pay out at roughly **1 in 15.9** (any tier). The fixed-prize pool takes in $0.30 per ticket and pays out an expected $0.21 per ticket, leaving about a 30% safety margin to keep the pool solvent long-term.

The jackpot pool works on a "roll over until someone wins" model: if nobody hits the jackpot for several rounds in a row, the pool just keeps growing — bigger and bigger — until a player finally matches every number. That's the same "rolling jackpot" mechanic most players already know from other lotteries, except here the pool balance and win determination are executed live by the on-chain contract, and anyone can check the jackpot pool's actual BCH balance at any time.

---

## 7. System Architecture: State as UTXOs

Global Lucky Cash has no off-chain database of any kind. Everything the system needs to track is expressed as NFTs — distinguished by a purpose byte under a given Token Category — locked to their respective CashScript contract addresses. Here's the full list:

| Purpose Byte | NFT Name | Count | Capability | Role |
|---|---|---|---|---|
| `01` | **RoundShardAuthNFT** (round shard authorization) | 64 | `minting` | Carries the current round's authoritative info; split into 64 shards to absorb ticket-sale traffic in parallel — player payments sit here temporarily |
| `02` | **NumberSalesNFT** (per-number sales counter) | 79,360 | `mutable` | One UTXO per number combination, tracking how many tickets that combination has sold, used to compute jackpot shares |
| `03` | **RoundSwitchControlNFT** (round-switch control) | 1, system-wide | `minting` | Aggregates settlement progress across all 64 shards; tracks the current round, sale cutoff time, and total tickets sold |
| `04` | **DrawingNFT** (drawing marker) | 1 per round (burned after use) | `minting` | Records the round number and scheduled drawing time, preventing a round from being drawn twice |
| `05` | **WinningNumberNFT** (winning-number record) | 2 per round | `minting` on the fixed-prize side, `none` on the jackpot side | Records the round's winning numbers; one copy stays permanently in the fixed-prize pool so players can claim fixed prizes anytime, the other is sent to the jackpot pool, verified, and burned |
| `06` | **ConfigNFT** (configuration) | 1, system-wide | `none` | Records the genesis timestamp, round length, shard count, and other fixed parameters that round-switch transactions check against |
| `07` | **CanceledRoundNFT** (canceled-round marker) | 1 per cancellation | `minting` | Minted when the oracle fails and a round times out, giving players proof they can use to reclaim their ticket money for that round (see Section 10) |
| `08` | **DonationMessageNFT** (donation message) | 1 per donation collected, kept permanently | `none` | Records the round, amount, and message hash for a jackpot donation, as a public, auditable donation record |
| `09` | **ShardSettlementNFT** (shard settlement) | 1 per shard per round | `mutable` | Produced by `settle()`; temporarily holds one shard's settled sales amount and ticket count before it's aggregated into the master control NFT (see Section 8) |
| `0A` | **JackpotPoolNFT** (jackpot pool state) | Grows with each win | `minting` | The UTXO itself holds all of the jackpot's BCH; records whether the pool is currently "accumulating" or "won, awaiting claims" |
| `0B` | **GameOverNFT** (game-over confirmation) | 1, system-wide, minted only if the game is permanently shut down | `none` | Records the timestamp when the game was formally declared over, serving as the trigger credential for each contract's `endGame()` wind-down function (see Section 10) |
| `0C` | **JackpotClaimRangeNFT** | Minted during the game-over wind-down | `none` | Lets players claim their proportional share of any undistributed jackpot funds after the game has ended |
| — | **TicketNFT** (ticket) | Minted on every purchase | `none` | The winning credential a player holds, locked to the player's own wallet address — has no dedicated contract of its own |

The platform pool and the fixed-prize pool deliberately **don't use any NFT at all** — they just hold plain BCH (no token) at their respective contract addresses: multiple UTXOs sharing one address. The platform pool only supports `adminWithdraw()` for the platform to withdraw its operating cut, while the fixed-prize pool's payout logic is driven by the WinningNumberNFT (`minting`) described above.

**Why split things into 64 shards and 79,360 UTXOs?** Because under the UTXO model, a single UTXO can only be spent by one transaction at a time. If the whole system had just one "master ticket ledger" UTXO, every player's purchase transaction would collide with every other one and mostly fail. By splitting "round authorization" into 64 shards and "number sales counters" into 79,360 independent UTXOs, different players buying different numbers — or even the same number through different shards — can land on-chain simultaneously, which gives the system natural horizontal scaling. 64 shards turns out to be plenty because BCH supports unlimited chained 0-conf transactions: multiple purchases within the same shard don't need to wait for the previous one to confirm before the next one goes out, so you don't need a huge shard count just to absorb high concurrency — 64 already provides ample parallelism.

**How does a contract tell apart a pile of UTXOs that all share the same address?** By a field in the NFT commitment: RoundShardAuthNFT uses a "shard index" (0–63), and NumberSalesNFT uses the "lottery number" (encoded in 4 bytes). Whenever a contract validates a transaction, every NFT input goes through a **triple check** — is the Token Category correct, is the commitment length correct, is the purpose byte correct — to keep anyone from crafting a fake NFT that matches the format but not the content, and sneaking it into a transaction to trick the contract.

Take the TicketNFT as an example — its commitment is encoded directly in hex, so a player can eyeball it themselves:

```
0003ff01020304ff00000080ff00
```

In order, that decodes to: round 3, main numbers 1/2/3, Bonus Number 4, sale exchange rate 128, and claim status "unclaimed." Players don't have to rely on the front end's interpretation at all — in principle, anyone can read their own ticket's raw commitment directly.

---

## 8. Round Lifecycle and Fund Flow

### 8.1 Six Stages, All Publicly Triggerable

![Six-stage state diagram: On Sale → Settling → Aggregating → Awaiting Draw → Drawn](/whitepaper-assets/round-lifecycle-en.png)

A new round's ticket sales can start the moment the "enter drawing phase" transaction completes and the round number increments — there's no need to wait for the previous round's drawing and prize claims to finish first. Sales, settlement, aggregation, drawing, verifying wins, and both jackpot and fixed-prize claims all overlap and run in parallel without blocking each other.

"Settling" and "aggregating" are two distinct transaction types: each shard has its own independent sale cutoff time, and once it passes, anyone can trigger `settle()` for **that one shard**, moving its accumulated sales total out of the RoundShardAuthNFT and into a ShardSettlementNFT — at this point the money is still scattered across shards, not yet aggregated. Only once every shard has settled does `aggregate()` fold those scattered ShardSettlementNFTs into the master RoundSwitchControlNFT. Because of the per-transaction size limit, aggregation is always split into two batches of 32 shards each — both batches have to complete before the round can move into the drawing phase.

### 8.2 Fund Flow: The Timing and Ratio Behind the 50/30/20 Split

Player payments aren't split across the prize pools the instant a ticket is sold. Instead, they're held and distributed all at once, proportionally, at the "enter drawing phase" transaction. Here's the path:

```
Player pays for a ticket
   → Held in RoundShardAuthNFT (accumulates throughout the sale period, per shard, independently)
      → settle(): that shard settles, funds move into a ShardSettlementNFT (still scattered across shards)
         → aggregate(): 2 batches of 32 shards each, folded into RoundSwitchControlNFT
            → At "enter drawing phase," funds are split once, by fixed ratio:
                50% → Jackpot pool (JackpotPoolNFT, added directly to its BCH balance)
                30% → Fixed-prize pool (plain BCH, funds the 4 fixed-prize tiers)
                20% → Platform (plain BCH, for the platform to withdraw as operating revenue)
```

This design deliberately keeps "frequent, small ticket sales" separate from "infrequent, large-scale distribution": sale transactions don't need to split into three payouts every single time — the money just rolls forward, untouched, to the next stage, until aggregation completes and a single one-time distribution actually happens. That keeps overall fees and contract complexity down.

### 8.3 Economic Incentives: A System That Doesn't Depend on Platform Uptime

Settling, aggregating, entering the drawing phase, drawing, verifying wins, and processing expirations — the handful of transaction types that "advance the system" — all carry a built-in **execution reward worth a flat $1** (processing expirations instead pays 1% of the expired amount), paid to whoever triggers the transaction. In other words:

- Anyone — including players themselves, or a third-party keeper service — can write a script that watches on-chain state and races to submit a transaction the moment conditions are met, collecting the execution reward.
- That means the system's "heartbeat" doesn't depend on the platform's servers running 24/7. Even if every one of the platform's operational services went down, the game keeps moving forward as long as at least one party — even just someone chasing the reward — is willing to execute the transactions.
- When the DrawingNFT is minted during "enter drawing phase," it carries an extra reserve worth roughly $3, to cover the execution rewards for the two subsequent transactions — drawing and verifying wins — so that reward funding stays stable and doesn't run dry on a low-sales round.

### 8.4 Jackpot Claim Example

The jackpot is settled by claiming **proportionally against current outstanding tickets**, one at a time, rather than splitting the whole pool evenly across every winner up front. Here's a simplified example (dust deductions ignored):

> The jackpot pool has accumulated 300 BCH, with 3 winning tickets still unclaimed.
> The first claimant takes 300 ÷ 3 = 100 BCH. The pool now holds 200 BCH, with 2 claimants remaining.
> The second claimant takes 200 ÷ 2 = 100 BCH. The pool now holds 100 BCH, with 1 claimant remaining.
> The third claimant takes 100 ÷ 1 = 100 BCH. The pool is left holding only the 1,000-sat dust.

Every winner ends up with the same 100 BCH, no matter the order they claim in or how the pool's balance shifts in the meantime — the math guarantees each person gets their fair share.

---

## 9. Randomness and Verifiable Fairness

The core trust problem in any lottery is: where do the winning numbers actually come from? Global Lucky Cash uses signed price messages from the [oracles.cash](https://oracles.cash/api-docs/) standard price oracle as its source of entropy. Here's the process:

1. The contract has an **oracle public key** hard-coded at deployment time (currently operated by General Protocols), and only accepts messages signed by that key.
2. A drawing transaction must supply **two consecutive** oracle price messages (their Message Sequence numbers must differ by exactly 1), where the first message's timestamp is before the scheduled drawing time and the second is at or after it.
3. `sha256(signature) mod 79,360` is computed on the **second message's signature**, producing the index of the winning number combination.
4. That index maps back to an actual number combination via a fixed formula: `idx = comboIdx × 16 + (Bonus Number − 1)`, where `comboIdx` is derived from a nested enumeration ordered main-number-3 → main-number-2 → main-number-1, with the Bonus Number as the innermost, fastest-changing component.

### 9.1 Why the Person Who Triggers the Draw Can't Pick a Favorable Quote

The oracle's message sequence numbers are strictly, globally increasing, and its timestamps are monotonically increasing too. That means the combination of "first timestamp before the scheduled drawing time, second timestamp at or after it, sequence numbers adjacent" is **unique** across the oracle's entire history — and anyone can download the oracle's public historical messages and recompute that for themselves. That means **any third party can independently audit every single round's drawing result** without taking the platform's word for it. It's also why the front end already ships a public "Verify" page.

### 9.2 An Honest Disclosure of the Trust Assumption

In the interest of writing an honest whitepaper, we have to point out: the system currently depends on the signing key of a **single oracle operator** (General Protocols) as its source of randomness, which is, at its core, still a centralized point of trust — if that oracle went down or its private key were compromised, it would directly affect the availability and security of the drawing process. That falls short of a fully trustless ideal, and it's the one external trust assumption this system still carries. A refund mechanism already exists for the case where the oracle fails and a round can't be drawn (see Section 10); the remaining risks are disclosed in full in Section 15.

To be concrete about it: a leaked private key wouldn't just be some abstract hit to "the drawing process." The guarantee in Section 9.1 — that a qualifying pair of quotes is globally unique — depends on those quotes actually coming from the oracle's real, historical record. Once the private key leaks, an attacker is no longer bound by that history at all: they could fabricate a price message that never happened — exchange rate, timestamp, sequence number, all made up — and sign it with the stolen key. The contract only checks that the signature matches the public key; it has no way to tell a forged message from a real one. In other words, a leaked key doesn't just make the outcome "more predictable" — it lets whoever holds the key dictate the winning numbers directly. After each drawing, anyone can still take the timestamp recorded in the WinningNumberNFT and cross-check it against oracles.cash's public history to catch a forged quote after the fact — but that's only a post-hoc audit; it can't stop funds from being claimed before the forgery is caught.

---

## 10. Security Design and Threat Model

During development, the following attack surfaces were specifically analyzed and addressed:

| Risk | Status | Explanation |
|---|---|---|
| Double claims / forged tickets | **Resolved** | The CashTokens protocol layer guarantees a Token Category can't be forged; a ticket's "claim status" field is written exclusively by the contract, so an already-claimed ticket can never be used again |
| Oracle randomness manipulation (trigger picks a favorable quote) | **Resolved** | As described in Section 9.1, a qualifying quote pair is globally unique in the oracle's history, so the trigger has no way to choose a combination favorable to themselves. This guarantee assumes the oracle's private key hasn't leaked — see Section 9.2 for the risk and mitigation if it has |
| Repeated settlement/aggregation triggers | **Resolved** | `settle()` checks that a shard's own round matches the round recorded on the ShardSettlementNFT it produces, and `aggregate()` separately checks that the ShardSettlementNFT's round matches the master control NFT's round. Once settlement or aggregation completes, the condition that allowed it no longer holds, so it can't be repeated |
| Prizes/credentials routed to the wrong address | **Resolved** | Every output that mints an NFT or pays out a prize is checked at the contract level to ensure its `lockingBytecode` matches either the player's payment input or the address holding the credential, which rules out a transaction builder redirecting assets to themselves or a third party |
| Forged NFT input injection | **Resolved** | Every NFT input must pass a triple check — Token Category, commitment length, and purpose byte — preventing NFTs meant for one role under a given Token Category from being mixed in to mislead the contract's logic |
| Fixed-prize pool briefly running short of funds | **Known, accepted for now** | Fixed prizes have no claim deadline, so players can simply wait and retry after the next round's funds come in; principal is never at risk |
| The system stalling entirely | **Known, accepted for now** | Because the execution-reward mechanism in Section 8.3 benefits every participant, "nobody is willing to advance the system" is, in practice, extremely unlikely |
| Prolonged oracle outage prevents a drawing | **Resolved** | If a valid oracle quote still can't be obtained 2 hours past the scheduled drawing time, anyone can trigger `cancelDraw()` to cancel that round's drawing and mint a CanceledRoundNFT. Players can then use `claimCanceledRoundRefund()` to get that round's ticket money back |
| Round-switch delay attack (cutoff-time manipulation) | **Resolved** | The "scheduled drawing time" isn't based on when the trigger actually happens to submit a settlement/aggregation transaction — it's derived from the maximum of all 64 shards' own `lastSoldTime` ratchets (updated on every sale, monotonically non-decreasing, never reset across rounds), plus 3 hours (`aggregate()` computes `maxLastSoldTime`; `enterDrawingPhase()` derives `expectedDrawTime` from it). For a trigger to deliberately push the scheduled drawing time toward an oracle timestamp they've already seen published, every one of the 64 shards would need to have zero real ticket sales during that entire window — as long as even one honest player buys a ticket on any shard during the sale period, that shard's `lastSoldTime` stays close to real time, which pulls the maximum close to real time too, leaving the attacker with no way to manipulate it |

**What "Resolved" actually means here**: items marked Resolved are fully covered by the existing contract logic and don't depend on an audit or future hardening. Items marked "known, accepted" are limitations the team evaluated and decided were acceptable — none of them put player principal at risk.

**On contract upgrades and patching**: this system is built on a fully decentralized contract architecture — funds are locked to publicly auditable contract addresses, and the rules are hard-coded and can't be unilaterally changed. That's a deliberate tradeoff: keeping the ability to "patch a bug after it's found" would require some on-chain privilege capable of moving funds — including an actively accumulating jackpot — into a new contract, and the moment that privilege exists, players would have to trust the platform not to abuse it. That's exactly the trust gap this system set out to avoid in the first place (see Section 2).

So, once the game is live, the platform **will not retain or design any form of contract upgrade or bug-patching mechanism**. If a contract vulnerability is discovered after launch and causes a loss of funds, the platform cannot compensate for it and will not "patch" the original contract or move funds through any means — that's the risk that necessarily comes with choosing full decentralization and refusing the platform any special privilege, and it's a risk the players and the platform accept together.

**Wind-down settlement after the game permanently ends**: all 8 contracts each implement an `endGame()` function, triggered by an admin-authorized NFT — but this is **not** an exception to the "no upgrades, no patches" rule above. It can only be called after the game has **permanently ended** (defined as 4 consecutive drawings canceled due to oracle failure, which triggers `declareGameOver()` to formally declare the game over). For the two contracts that actually hold player funds — the jackpot pool and the fixed-prize pool — there's an additional **90-day** waiting period after game-over is declared, giving players ample time to claim their proportional share of the jackpot via `claimJackpotShareRefund()` before `endGame()` performs a final settlement of whatever residual funds remain unclaimed once that window closes. In short: this is an exit-settlement mechanism for "the game is definitely never resuming, and players have already had their chance to claim their share" — not a privilege that can step in and move funds around while the game is still running.

---

## 11. Walletless Ticket Purchases: Lowering the Barrier to Entry

Since most lottery players aren't familiar with operating a crypto wallet, the system includes a **TicketDeposit** mechanism that lets players participate without ever learning to use an on-chain wallet:

1. Based on the round and number combination the player selects, the platform computes a **unique, deterministic**, one-time contract address.
2. The player just sends the exact BCH amount to that address from wherever they like — an exchange withdrawal, for instance — without signing any on-chain transaction themselves.
3. Once the platform detects the deposit, it submits the purchase transaction on the player's behalf, and the ticket NFT is minted **directly** to the receiving address the player specified — no second transfer needed.
4. If the purchase can't go through for some reason (say, the round already switched), **anyone** can call the refund function to force the BCH back to the player's address — even the platform itself has no way to keep that money or redirect it elsewhere.

This collapses the usual three-step hurdle — "buy BCH, then learn a wallet, then operate a contract" — down to just "send money to an address," while still keeping the on-chain guarantee that a player's funds can only ever end up back in the player's own hands.

---

## 12. Platform Role and Economic Incentive Design

| Role | Description |
|---|---|
| **Player** | Buys tickets, holds ticket NFTs, and can initiate a claim transaction after a drawing |
| **Trigger** | Executes the on-chain operations that advance the system — settlement, aggregation, drawing, verifying wins, processing expirations. **Anyone can act as a Trigger, no authorization required**, and doing so earns the execution reward |
| **Platform** | Provides the front-end interface and operational services, and acts as a Trigger by default. Its revenue comes from a fixed 20% cut of each round's ticket sales. **Under this fully decentralized architecture, the platform holds no on-chain privilege over game rules, fund custody, or the ability to pause the system.** The only on-chain action it retains during normal gameplay is withdrawing its own share from the platform pool via an admin-authorized NFT — plus one wind-down action that can only ever trigger after the game has permanently ended (`endGame()`, see Section 10), which has no bearing on fund safety during normal operation |

That makes the platform's business model refreshingly straightforward: **build a good product, attract players, and earn a fixed percentage of ticket sales** — not profit from controlling the prize pools or the drawing process. That's the core difference between this system and either a traditional lottery or an opaque on-chain gambling operation.

---

## 13. Comparison with Traditional Lotteries and Other On-Chain Gambling

| Aspect | Traditional Lottery | Typical "On-Chain" Gambling (UI on-chain, logic still centralized) | Global Lucky Cash |
|---|---|---|---|
| Drawing mechanism | Physical ball machine or an internal RNG, unverifiable from the outside | Usually decided by a back-end server; the chain just records the result | Oracle signature + on-chain computation; anyone can independently recompute and verify |
| Fund custody | Held in the operator's private accounts | Centralized wallet or multisig; players must trust the operator | Locked to publicly auditable contract addresses; rules are hard-coded and can't be misappropriated |
| Rule changes | The operator can change them unilaterally | Usually adjustable via a contract upgrade or admin key | Rules are fixed once the contract is deployed; the platform has no on-chain special privilege |
| System uptime | Depends on the operator staying in business | Depends on the operator's servers/keepers staying up | Everyone has an economic incentive to keep the process moving; not dependent on any single operator |
| Barrier to entry | Requires local retail channels, possibly ID verification | Usually still requires wallet know-how | Works with a standard wallet, or with a one-time walletless deposit |
| Transparency | Periodic summary announcements | Some on-chain transaction records, but the core logic is mostly a black box | Every piece of state is queryable on-chain in real time, down to tickets sold per number and live prize pool balances |

---

## 14. Development Status and Scope

Here's where things actually stand, and which parts are a deliberate scope decision by the team rather than something still in progress:

### 14.1 Completed

- The complete logic for all 8 CashScript contracts: `RoundShardAuth`, `NumberSales`, `RoundSwitchControl`, `Drawing`, `FixedPrizePool`, `JackpotPool`, `PlatformPool`, `TicketDeposit`
- The full transaction flow: ticket sales, settlement, aggregation, entering the drawing phase, drawing, verifying wins, fixed-prize claims, jackpot claims, and processing expirations
- The oracle-failure refund mechanism: `cancelDraw()` for timeout cancellation plus `claimCanceledRoundRefund()` (see Section 10)
- The jackpot donation mechanism: `playerDonation()` / `collectDonation()`, with a public, auditable DonationMessageNFT record for every donation
- The permanent wind-down mechanism: `declareGameOver()` to declare the game over, plus each contract's `endGame()` (see Section 10)
- A full-scale genesis deployment flow matching the 64-shard / 79,360-combination design
- The front-end DApp, including wallet-connected purchases, walletless purchases (TicketDeposit), a drawing-process control panel, and a public verification page
- Every protection mechanism marked "Resolved" in the Section 10 security design above (including the round-switch delay attack protection)

### 14.2 Deliberately Out of Scope

The following aren't "not done yet" — the team evaluated them and explicitly decided not to build them:

- **pUSD (stablecoin) payment support**: this system only accepts BCH; there's no plan to support stablecoin-denominated payments. Supporting pUSD alongside BCH would mean the prize pools and payouts hold a mix of BCH and pUSD, and every transaction — sales, settlement, aggregation, jackpot and fixed-prize claims — would need extra logic to handle the ratio and conversion between two assets. The team decided that added complexity wasn't worth it and chose to support BCH exclusively.
- **Third-party security audit**: this project is positioned as an experimental, open-source project. Rather than paying a single firm for an audit report, it makes the contract source fully public so anyone can review and verify the logic themselves. That means there's no audit firm vouching for the contracts' security, and the risk of interacting with the funds is the user's own to evaluate (see Section 15).

---

## 15. Risk Disclosure and Disclaimer

- This document is a technical and product design write-up. **Nothing in it constitutes financial, legal, or investment advice of any kind.**
- Lottery and gambling activities are heavily regulated — or outright prohibited — in many jurisdictions. Confirm the legality in your own jurisdiction before participating; the project takes no responsibility for a user's compliance obligations.
- Smart contracts carry inherent code risk. This project **does not plan to commission a third-party security audit**, choosing instead to make the contract source fully open for anyone to review and verify (see Section 14.2). That means no audit firm is vouching for the contracts' security; this project is experimental in nature, and all risk from interacting with the funds is the user's own to bear.
- Section 9.2 already discloses, honestly: the system's current randomness source still depends on a single oracle operator's signing key, which falls short of a fully trustless design. That risk is disclosed here in full.
- Once this system's contracts go live, they carry **no upgrade or patch mechanism whatsoever** (see Section 10). If a vulnerability is discovered later and funds are lost as a result, the platform cannot offer compensation — that's a risk players must accept as the necessary cost of a fully decentralized architecture.

---

## 16. Closing Remarks

What Global Lucky Cash is trying to prove is this: a lottery — traditionally an activity that leans heavily on institutional trust — can, through the combination of the UTXO model and CashTokens, turn its rules, its funds, and its drawing results into on-chain facts that anyone can independently verify and independently push forward, rather than just dressing up a familiar interface in blockchain branding.

The contract logic and the full-scale deployment process are both complete. This project is positioned as an experimental, open-source effort — one that chose not to commission a third-party audit, and instead to make the contract source fully public so anyone can review and verify it themselves. That's also why this document lays out the design philosophy, the mechanism details, and the known risks as candidly as it does: so readers can form their own independent, informed judgment about where the system actually stands, rather than seeing only the parts that flatter the project.

---

*This document reflects the actual state of the codebase at the time of writing. Where anything here and the code implementation disagree, the code is authoritative.*
