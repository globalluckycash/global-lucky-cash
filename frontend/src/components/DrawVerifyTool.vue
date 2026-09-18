<template>
  <div class="bg-bg-card border border-white/5 rounded-xl p-5">
    <div class="flex flex-col sm:flex-row gap-3 mb-2">
      <input
        v-model.number="round"
        type="number"
        min="1"
        :placeholder="t('verify.draw_round_placeholder')"
        class="flex-grow bg-black/30 border border-white/10 rounded-lg px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-bch/50"
      />
      <button
        class="shrink-0 bg-gradient-to-r from-bch to-bch-glow text-black px-6 py-2.5 rounded-lg font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:scale-[1.02] transition"
        :disabled="!round || loading"
        @click="$emit('verify', round!)"
      >
        {{ t('verify.draw_button') }}
      </button>
    </div>

    <div v-if="loading" class="text-center text-gray-500 py-8 text-sm">
      <i class="fa-solid fa-gear spinner mr-2"></i>{{ t('verify.draw_loading') }}
    </div>

    <div v-else-if="error" class="text-red-400 text-xs text-center py-6">
      <i class="fa-solid fa-triangle-exclamation mr-1"></i>{{ error }}
    </div>

    <div v-else-if="result && !result.found" class="text-yellow-400/90 text-xs text-center py-6">
      <i class="fa-solid fa-circle-question mr-1"></i>{{ t('verify.draw_not_found') }}
    </div>

    <div v-else-if="result" class="mt-4 space-y-6">
      <!-- Step 1: 64 shard settle txids -->
      <div>
        <h4 class="font-bold text-sm mb-1">{{ t('verify.draw_step1_heading') }}</h4>
        <p class="text-gray-500 text-xs leading-relaxed mb-1">{{ t('verify.draw_step1_desc', { round: result.round, next: result.round + 1 }) }}</p>
        <p class="text-gray-600 text-[11px] font-mono leading-relaxed mb-3">{{ t('verify.draw_step1_bytes') }}</p>
        <div class="grid grid-cols-8 sm:grid-cols-10 gap-1.5">
          <a
            v-for="(txid, shardId) in result.settleTxids"
            :key="shardId"
            :href="txid ? explorerTxUrl(txid) : undefined"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center justify-center text-[11px] font-mono rounded-lg py-1.5 transition"
            :class="txid
              ? 'bg-bch/10 text-bch hover:bg-bch/20 cursor-pointer'
              : 'bg-white/5 text-gray-600 cursor-not-allowed pointer-events-none'"
            :title="txid ? txid : t('verify.draw_txid_missing')"
          >
            {{ shardId }}
          </a>
        </div>
      </div>

      <!-- Step 2: aggregate txids (batch A + batch B) -->
      <div>
        <h4 class="font-bold text-sm mb-1">{{ t('verify.draw_step2_heading') }}</h4>
        <p class="text-gray-500 text-xs leading-relaxed mb-1">{{ t('verify.draw_step2_desc') }}</p>
        <p class="text-gray-600 text-[11px] font-mono leading-relaxed mb-2">{{ t('verify.draw_step2_bytes') }}</p>
        <div class="space-y-1.5">
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-gray-500 shrink-0">{{ t('verify.draw_step2_batch_a') }}</span>
            <TxidLink :txid="result.aggregateTxids.batchA" />
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-gray-500 shrink-0">{{ t('verify.draw_step2_batch_b') }}</span>
            <TxidLink :txid="result.aggregateTxids.batchB" />
          </div>
        </div>
      </div>

      <!-- Step 3: enterDrawingPhase txid -->
      <div>
        <h4 class="font-bold text-sm mb-1">{{ t('verify.draw_step3_heading') }}</h4>
        <p class="text-gray-500 text-xs leading-relaxed mb-1">{{ t('verify.draw_step3_desc') }}</p>
        <p class="text-gray-600 text-[11px] font-mono leading-relaxed mb-2">{{ t('verify.draw_step3_bytes') }}</p>
        <TxidLink :txid="result.enterDrawingPhaseTxid" />
      </div>

      <!-- Step 4: how to fetch the oracle data used for the draw -->
      <div>
        <h4 class="font-bold text-sm mb-1">{{ t('verify.draw_step4_heading') }}</h4>
        <p class="text-gray-500 text-xs leading-relaxed mb-1">{{ t('verify.draw_step4_desc', { oraclePubKey: props.oraclePubKey }) }}</p>
        <div v-if="result.drawTimeSecs" class="mt-2">
          <p class="text-gray-500 text-xs mb-1">{{ t('verify.draw_step4_api_hint') }}</p>
          <a
            :href="oracleApiUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="block bg-black/30 border border-bch/20 hover:border-bch/50 rounded-lg px-3 py-2 transition group"
          >
            <code class="text-bch text-[11px] font-mono break-all group-hover:text-bch-glow">{{ oracleApiUrl }}</code>
          </a>
          <p class="text-gray-600 text-[11px] mt-1">
            {{ t('verify.draw_step4_api_note', { time: new Date(result.drawTimeSecs * 1000).toISOString() }) }}
          </p>
        </div>
      </div>

      <!-- Step 5: how to compute the winning numbers from the oracle data -->
      <div>
        <h4 class="font-bold text-sm mb-1">{{ t('verify.draw_step5_heading') }}</h4>
        <p class="text-gray-500 text-xs leading-relaxed mb-1">{{ t('verify.draw_step5_desc') }}</p>
        <p class="text-gray-600 text-[11px] font-mono leading-relaxed mb-2">{{ t('verify.draw_step5_bytes') }}</p>

        <!-- 互動式計算器 -->
        <div class="mt-3 bg-black/20 border border-white/8 rounded-xl p-4 space-y-3">
          <!-- Signature 輸入 -->
          <div>
            <label class="text-gray-400 text-xs font-semibold block mb-1">
              {{ t('verify.step5_sig_label') }}
            </label>
            <div class="flex gap-2">
              <input
                v-model="step5Sig"
                type="text"
                :placeholder="t('verify.step5_sig_placeholder')"
                spellcheck="false"
                class="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[11px] font-mono text-green-300 focus:outline-none focus:border-bch/50 placeholder-gray-700"
                @input="step5Compute"
              />
              <button
                v-if="result?.drawTimeSecs && !step5Fetching"
                class="shrink-0 text-xs px-3 py-2 rounded-lg border border-bch/30 text-bch hover:bg-bch/10 transition"
                @click="step5FetchAndCompute"
              >
                {{ t('verify.step5_auto_fetch') }}
              </button>
              <span v-if="step5Fetching" class="shrink-0 text-xs text-gray-500 px-2 py-2">
                <i class="fa-solid fa-gear spinner mr-1"></i>
              </span>
            </div>
            <p v-if="step5Error" class="text-red-400 text-[11px] mt-1">
              <i class="fa-solid fa-triangle-exclamation mr-1"></i>{{ step5Error }}
            </p>
          </div>

          <!-- 計算結果 -->
          <div v-if="step5Result" class="space-y-3">
            <!-- 中間數值 -->
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div class="bg-black/30 rounded-lg px-3 py-2">
                <div class="text-gray-500 text-[10px] mb-0.5">sha256(signature)</div>
                <code class="text-yellow-400/80 text-[10px] font-mono break-all leading-tight">{{ step5Result.digestHex }}</code>
              </div>
              <div class="bg-black/30 rounded-lg px-3 py-2">
                <div class="text-gray-500 text-[10px] mb-0.5">idx（mod 79360）</div>
                <code class="text-white text-sm font-mono font-bold">{{ step5Result.idx }}</code>
              </div>
              <div class="bg-black/30 rounded-lg px-3 py-2">
                <div class="text-gray-500 text-[10px] mb-0.5">comboIdx（idx ÷ 16）</div>
                <code class="text-white text-sm font-mono font-bold">{{ step5Result.comboIdx }}</code>
              </div>
            </div>

            <!-- 中獎號碼展示 -->
            <div>
              <div class="text-gray-400 text-xs font-semibold mb-2">{{ t('verify.step5_result_label') }}</div>
              <div class="flex flex-wrap items-center gap-2">
                <!-- 普通號 -->
                <NumberBall
                  v-for="n in [step5Result.n1, step5Result.n2, step5Result.n3]"
                  :key="'n' + n"
                  :number="n"
                  color="green"
                />
                <!-- 分隔 + -->
                <span class="text-gray-500 text-sm font-bold">+</span>
                <!-- 特別號 -->
                <NumberBall :number="step5Result.s" color="purple" />
                <span class="text-gray-500 text-xs ml-1">{{ t('verify.step5_special_label') }}</span>
              </div>
            </div>

            <!-- 驗算公式 -->
            <div class="bg-black/30 rounded-lg px-3 py-2">
              <div class="text-gray-500 text-[10px] mb-1">{{ t('verify.step5_verify_formula') }}</div>
              <code class="text-gray-300 text-[11px] font-mono">
                ({{ step5Result.n3 }}-1)({{ step5Result.n3 }}-2)({{ step5Result.n3 }}-3)/6 + ({{ step5Result.n2 }}-1)({{ step5Result.n2 }}-2)/2 + ({{ step5Result.n1 }}-1)
                = {{ step5Result.formulaCheck }} {{ step5Result.formulaCheck === step5Result.comboIdx ? '✅' : '❌' }}
              </code>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 6: draw txid -->
      <div>
        <h4 class="font-bold text-sm mb-1">{{ t('verify.draw_step6_heading') }}</h4>
        <p class="text-gray-500 text-xs leading-relaxed mb-1">{{ t('verify.draw_step6_desc') }}</p>
        <p class="text-gray-600 text-[11px] font-mono leading-relaxed mb-2">{{ t('verify.draw_step6_bytes') }}</p>
        <TxidLink :txid="result.drawTxid" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { explorerTxUrl } from '@/lib/explorer'
import TxidLink from '@/components/TxidLink.vue'
import NumberBall from '@/components/NumberBall.vue'
import type { DrawTrail } from '@/lib/electrum'

const props = defineProps<{
  loading: boolean
  result: DrawTrail | null
  error: string | null
  initialRound?: number | null
  oraclePubKey: string
}>()

defineEmits<{ verify: [round: number] }>()

const { t } = useI18n()
const round = ref<number | null>(props.initialRound ?? null)

// 產生 oracle API 查詢連結：帶入 publicKey 與 minMessageTimestamp（開獎時間），
// 只取 1 筆，直接就是開獎使用的那筆報價
const oracleApiUrl = computed(() => {
  if (!props.result?.drawTimeSecs) return ''
  const params = new URLSearchParams({
    publicKey: props.oraclePubKey,
    minMessageTimestamp: String(props.result.drawTimeSecs),
    count: '1',
  })
  return `https://oracles.generalprotocols.com/api/v1/oracleMessages?${params.toString()}`
})

// ─── Step 5：從 oracle signature 計算中獎號碼 ─────────────────────────────────

interface Step5Result {
  digestHex: string
  idx: number
  comboIdx: number
  s: number
  n1: number
  n2: number
  n3: number
  formulaCheck: number
}

const step5Sig = ref('')
const step5Result = ref<Step5Result | null>(null)
const step5Error = ref<string | null>(null)
const step5Fetching = ref(false)

/**
 * 把 oracle signature（64 bytes hex）計算出中獎號碼。
 * 演算法（對應 contracts/Drawing.cash draw()）：
 *   digest = sha256(signature)
 *   以 little-endian 有符號整數解讀 digest，取絕對值，對 79360 取餘數 → idx
 *   s = idx % 16 + 1  （特別號，1~16）
 *   comboIdx = Math.floor(idx / 16)  （普通號索引，0~4959）
 *   反推 n3: 最小的 n3 使得 (n3-1)(n3-2)(n3-3)/6 > comboIdx
 *           即 C(n3-1,3) <= comboIdx < C(n3,3)
 *   再反推 n2、n1。
 */
async function computeFromSig(sigHex: string): Promise<Step5Result | null> {
  const cleaned = sigHex.trim().toLowerCase()
  if (!/^[0-9a-f]{128}$/.test(cleaned)) return null

  // sha256
  const sigBytes = hexToUint8(cleaned)
  const hashBuf = await crypto.subtle.digest('SHA-256', sigBytes.buffer as ArrayBuffer)
  const digestBytes = new Uint8Array(hashBuf)
  const digestHex = uint8ToHex(digestBytes)

  // Little-endian signed integer → 取絕對值 → mod 79360
  // 把 32 bytes 當成 little-endian 256-bit 有符號整數：
  //   如果最後一個 byte（最高有效位元組）的最高位 = 1 → 負數（取二補數）
  const isNegative = (digestBytes[31] & 0x80) !== 0
  let bigVal: bigint
  if (!isNegative) {
    // positive: 直接轉 LE bigint
    bigVal = leBytesToBigInt(digestBytes)
  } else {
    // negative: two's complement → negate
    const negated = new Uint8Array(digestBytes)
    // two's complement: flip all bits then +1
    let carry = 1
    for (let i = 0; i < negated.length; i++) {
      const sum = (~negated[i] & 0xff) + carry
      negated[i] = sum & 0xff
      carry = sum >> 8
    }
    bigVal = leBytesToBigInt(negated)
  }

  const TOTAL_COMBOS = 79360n
  const idx = Number(bigVal % TOTAL_COMBOS)
  const s = (idx % 16) + 1
  const comboIdx = Math.floor(idx / 16)

  // 反推 n1, n2, n3（1-based，n1 < n2 < n3，組合數索引 = comboIdx）
  // comboIdx = C(n3-1,3) + C(n2-1,2) + C(n1-1,1) - 1 ... 其實是：
  // comboIdx = (n3-1)(n3-2)(n3-3)/6 + (n2-1)(n2-2)/2 + (n1-1)
  let n3 = 3
  while ((n3 - 1) * (n3 - 2) * (n3 - 3) / 6 <= comboIdx) n3++
  n3--
  const rem2 = comboIdx - (n3 - 1) * (n3 - 2) * (n3 - 3) / 6

  let n2 = 2
  while ((n2 - 1) * (n2 - 2) / 2 <= rem2) n2++
  n2--
  const n1 = rem2 - (n2 - 1) * (n2 - 2) / 2 + 1

  // 驗算
  const formulaCheck = (n3 - 1) * (n3 - 2) * (n3 - 3) / 6
    + (n2 - 1) * (n2 - 2) / 2
    + (n1 - 1)

  return { digestHex, idx, comboIdx, s, n1, n2, n3, formulaCheck }
}

function leBytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n
  for (let i = bytes.length - 1; i >= 0; i--) {
    result = (result << 8n) | BigInt(bytes[i])
  }
  return result
}

function hexToUint8(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return arr
}

function uint8ToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function step5Compute() {
  step5Error.value = null
  const sig = step5Sig.value.trim()
  if (!sig) { step5Result.value = null; return }
  const r = await computeFromSig(sig)
  if (!r) {
    step5Result.value = null
    step5Error.value = t('verify.step5_sig_invalid')
  } else {
    step5Result.value = r
  }
}

async function step5FetchAndCompute() {
  if (!oracleApiUrl.value) return
  step5Fetching.value = true
  step5Error.value = null
  step5Result.value = null
  try {
    const resp = await fetch(oracleApiUrl.value)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    const msg = Array.isArray(data) ? data[0] : data?.oracleMessages?.[0]
    const sig: string = msg?.signature ?? msg?.sig ?? ''
    if (!sig || sig.length !== 128) throw new Error(t('verify.step5_fetch_no_sig'))
    step5Sig.value = sig
    await step5Compute()
  } catch (e) {
    step5Error.value = e instanceof Error ? e.message : String(e)
  } finally {
    step5Fetching.value = false
  }
}

// 當查詢結果更新（新的 drawTimeSecs）時，清空上一次的計算結果
watch(() => props.result?.drawTimeSecs, () => {
  step5Sig.value = ''
  step5Result.value = null
  step5Error.value = null
})
</script>
