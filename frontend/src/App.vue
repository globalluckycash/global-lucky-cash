<template>
  <div class="min-h-screen flex flex-col">
    <div class="sticky top-0 z-50">
      <!-- Testnet warning banner -->
      <div v-if="isTestnet" class="bg-amber-400 text-black text-xs md:text-sm font-semibold text-center px-4 py-2 flex items-center justify-center gap-2 leading-snug">
        <i class="fa-solid fa-triangle-exclamation shrink-0"></i>
        <span>{{ t('testnet.banner') }}</span>
      </div>

      <!-- Navigation -->
      <nav class="border-b border-white/5 backdrop-blur-xl bg-bg-main/60">
      <div class="max-w-7xl mx-auto px-4 h-20 flex items-center justify-between">
        <!-- Logo -->
        <RouterLink to="/" class="flex items-center gap-2 md:gap-3 min-w-0 shrink-0">
          <img src="/logo.png" alt="Global Lucky Cash" class="w-9 h-9 md:w-10 md:h-10 rounded-full border border-bch/50 shadow-neon shrink-0 object-cover" />
          <span class="text-base md:text-xl font-bold tracking-tighter text-white truncate max-w-[92px] min-[350px]:max-w-none">GLOBAL <span class="text-bch">LUCKY CASH</span></span>
        </RouterLink>

        <!-- Desktop links -->
        <div class="hidden xl:flex items-center gap-6 text-sm font-semibold text-gray-400">
          <RouterLink to="/" class="nav-link">{{ t('nav.home') }}</RouterLink>
          <RouterLink to="/results" class="nav-link">{{ t('nav.results') }}</RouterLink>
          <RouterLink to="/donate" class="nav-link">{{ t('nav.donate') }}</RouterLink>
          <RouterLink to="/my-tickets" class="nav-link">{{ t('nav.my_tickets') }}</RouterLink>
          <RouterLink to="/rules" class="nav-link">{{ t('nav.rules') }}</RouterLink>
          <RouterLink to="/draw-process" class="nav-link">{{ t('nav.draw_process') }}</RouterLink>
          <RouterLink to="/verify" class="nav-link">{{ t('nav.verify') }}</RouterLink>
          <RouterLink to="/faq" class="nav-link">{{ t('nav.faq') }}</RouterLink>
        </div>

        <!-- Right: language + wallet -->
        <div class="flex items-center gap-2 md:gap-4 shrink-0">
          <div ref="langMenuRef" class="relative shrink-0">
            <button
              class="flex items-center gap-1.5 px-2 md:px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 text-xs font-mono text-gray-300 transition shrink-0"
              @click="langMenuOpen = !langMenuOpen"
            >
              <i class="fa-solid fa-globe"></i>
              <span class="hidden sm:inline">{{ localeOptions.find(o => o.code === locale)?.shortLabel }}</span>
            </button>
            <div
              v-if="langMenuOpen"
              class="absolute right-0 mt-2 w-36 rounded-lg border border-white/10 bg-bg-main shadow-xl overflow-hidden z-50"
            >
              <button
                v-for="opt in localeOptions"
                :key="opt.code"
                class="w-full text-left px-3 py-2 text-xs font-mono hover:bg-white/5 transition"
                :class="locale === opt.code ? 'text-bch' : 'text-gray-300'"
                @click="selectLocale(opt.code)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <button
            v-if="!walletStore.isConnected"
            :disabled="walletStore.status === 'connecting'"
            class="bg-bch text-black px-2.5 md:px-5 py-2 rounded-xl font-bold text-xs md:text-sm hover:shadow-neon-strong transition duration-300 disabled:opacity-60 disabled:cursor-wait flex items-center gap-2 whitespace-nowrap shrink-0"
            @click="connect"
          >
            <span
              v-if="walletStore.status === 'connecting'"
              class="w-3 h-3 border-2 border-black/40 border-t-black rounded-full animate-spin shrink-0"
            ></span>
            {{ walletStore.status === 'connecting' ? t('wallet.connecting') : t('wallet.connect') }}
          </button>
          <button
            v-else
            class="border border-bch/50 text-bch bg-bch/10 hover:bg-bch/20 px-2.5 md:px-5 py-2 rounded-xl font-bold text-xs md:text-sm transition duration-300 whitespace-nowrap shrink-0"
            @click="showWalletInfoModal = true"
          >
            {{ t('wallet.connected') }}
          </button>

          <!-- Mobile menu toggle -->
          <button class="xl:hidden text-gray-400 hover:text-white shrink-0" @click="mobileOpen = !mobileOpen">
            <i :class="mobileOpen ? 'fa-solid fa-xmark' : 'fa-solid fa-bars'" class="text-lg"></i>
          </button>
        </div>
      </div>

      <!-- Mobile menu -->
      <div v-if="mobileOpen" class="xl:hidden border-t border-white/5 py-4 px-4 space-y-2 bg-bg-main">
        <RouterLink to="/" class="block py-2 text-sm font-semibold text-gray-400 hover:text-bch" @click="mobileOpen = false">{{ t('nav.home') }}</RouterLink>
        <RouterLink to="/results" class="block py-2 text-sm font-semibold text-gray-400 hover:text-bch" @click="mobileOpen = false">{{ t('nav.results') }}</RouterLink>
        <RouterLink to="/donate" class="block py-2 text-sm font-semibold text-gray-400 hover:text-bch" @click="mobileOpen = false">{{ t('nav.donate') }}</RouterLink>
        <RouterLink to="/my-tickets" class="block py-2 text-sm font-semibold text-gray-400 hover:text-bch" @click="mobileOpen = false">{{ t('nav.my_tickets') }}</RouterLink>
        <RouterLink to="/rules" class="block py-2 text-sm font-semibold text-gray-400 hover:text-bch" @click="mobileOpen = false">{{ t('nav.rules') }}</RouterLink>
        <RouterLink to="/draw-process" class="block py-2 text-sm font-semibold text-gray-400 hover:text-bch" @click="mobileOpen = false">{{ t('nav.draw_process') }}</RouterLink>
        <RouterLink to="/verify" class="block py-2 text-sm font-semibold text-gray-400 hover:text-bch" @click="mobileOpen = false">{{ t('nav.verify') }}</RouterLink>
        <RouterLink to="/faq" class="block py-2 text-sm font-semibold text-gray-400 hover:text-bch" @click="mobileOpen = false">{{ t('nav.faq') }}</RouterLink>
      </div>
      </nav>
    </div>

    <!-- Page content -->
    <RouterView class="flex-grow" />

    <!-- Footer -->
    <footer class="border-t border-white/5 py-10 bg-black/20">
      <div class="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-6">
        <div class="flex flex-col md:flex-row items-center gap-2 md:gap-4">
          <div class="text-xs text-gray-500 font-mono">
            © 2026 GLOBAL LUCKY CASH. POWERED BY BITCOIN CASH SMART CONTRACTS.
          </div>
          <RouterLink to="/faq" class="text-xs text-gray-500 hover:text-bch transition underline underline-offset-2">
            {{ t('nav.faq') }}
          </RouterLink>
          <RouterLink to="/whitepaper" class="text-xs text-gray-500 hover:text-bch transition underline underline-offset-2">
            {{ t('nav.whitepaper') }}
          </RouterLink>
          <RouterLink to="/terms" class="text-xs text-gray-500 hover:text-bch transition underline underline-offset-2">
            {{ t('nav.terms') }}
          </RouterLink>
          <RouterLink to="/verify" class="text-xs text-gray-500 hover:text-bch transition underline underline-offset-2">
            {{ t('nav.verify') }}
          </RouterLink>
        </div>
        <div class="flex gap-6 text-gray-400">
          <a href="https://x.com/GlobalLuckyCash" target="_blank" rel="noopener noreferrer" class="hover:text-white transition" aria-label="X (Twitter)"><i class="fa-brands fa-x-twitter"></i></a>
          <a href="https://t.me/GlobalLuckyCash" target="_blank" rel="noopener noreferrer" class="hover:text-white transition" aria-label="Telegram"><i class="fa-brands fa-telegram"></i></a>
        </div>
      </div>
    </footer>

    <!-- Global toast -->
    <AppToast />

    <!-- Wallet info: connected addresses (cash + token), QR/copy, disconnect entry point -->
    <WalletInfoModal
      :visible="showWalletInfoModal"
      @close="showWalletInfoModal = false"
      @disconnect="openDisconnectConfirm"
    />

    <!-- Disconnect wallet confirmation -->
    <ConfirmModal
      :visible="showDisconnectConfirm"
      :title="t('wallet.disconnect_confirm_title')"
      :message="t('wallet.disconnect_confirm_message')"
      :confirm-text="t('wallet.disconnect_confirm')"
      :cancel-text="t('wallet.disconnect_cancel')"
      @confirm="confirmDisconnect"
      @cancel="showDisconnectConfirm = false"
    />

    <!-- 首次進站歡迎彈窗 -->
    <WelcomeModal :visible="showWelcomeModal" @close="closeWelcomeModal" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, RouterView } from 'vue-router'
import AppToast from '@/components/AppToast.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import WalletInfoModal from '@/components/WalletInfoModal.vue'
import WelcomeModal from '@/components/WelcomeModal.vue'
import { useWalletStore } from '@/stores/wallet'
import { useContractStore } from '@/stores/contract'
import { useTicketStore } from '@/stores/ticket'
import { useToast } from '@/composables/useToast'
import { useLocaleSwitch } from '@/composables/useLocaleSwitch'
import { markContractStoreRefreshed } from '@/composables/useLiveRefresh'
import { reconcilePendingSignature } from '@/lib/pendingSignature'

const { t } = useI18n()
const { locale, localeOptions, setLocale } = useLocaleSwitch()
const walletStore = useWalletStore()
const contractStore = useContractStore()
const ticketStore = useTicketStore()
const { showToast } = useToast()

const mobileOpen = ref(false)
const showWalletInfoModal = ref(false)
const showDisconnectConfirm = ref(false)
const isTestnet = import.meta.env.VITE_NETWORK !== 'mainnet'

const WELCOME_SEEN_KEY = 'welcomeModalSeen'
const showWelcomeModal = ref(!localStorage.getItem(WELCOME_SEEN_KEY))

function closeWelcomeModal() {
  showWelcomeModal.value = false
  localStorage.setItem(WELCOME_SEEN_KEY, '1')
}

// contractStore 的背景輪詢（refreshHot/refreshCold）失敗時只會把訊息存進
// lastError，過去只有 HomeView 會顯示它——玩家在其他頁面完全看不到任何提示。
// 這裡在「從無錯誤變成有錯誤」的瞬間補一個全站可見的 toast，避免每次輪詢
// 重試（imminent tier 20 秒一次）都跳一個新的 toast 造成洗版。
watch(() => contractStore.lastError, (err, prevErr) => {
  if (err && !prevErr) showToast(err, 'warning')
})

const langMenuOpen = ref(false)
const langMenuRef = ref<HTMLElement | null>(null)

function selectLocale(code: string) {
  setLocale(code)
  langMenuOpen.value = false
}

function handleClickOutside(event: MouseEvent) {
  if (langMenuRef.value && !langMenuRef.value.contains(event.target as Node)) {
    langMenuOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', handleClickOutside))
onUnmounted(() => document.removeEventListener('click', handleClickOutside))

async function connect() {
  try {
    await walletStore.connectWalletConnect()
  } catch (err) {
    showToast(err instanceof Error ? err.message : String(err), 'error')
  }
}

function openDisconnectConfirm() {
  showWalletInfoModal.value = false
  showDisconnectConfirm.value = true
}

async function confirmDisconnect() {
  showDisconnectConfirm.value = false
  await walletStore.disconnect()
}

// Initial load
onMounted(async () => {
  // 不 await：查證窗口最長約 45 秒，不該卡住下面其他初始化流程。這個函式完全不依賴
  // 錢包連線狀態——待確認記錄裡已經帶著地址，只需要鏈上查詢（見 lib/pendingSignature.ts）。
  reconcilePendingSignature()

  walletStore.init()
  await contractStore.refresh()
  markContractStoreRefreshed()
  // Tier 1（熱資料，RSA shard 銷量）：固定 1 分鐘輪詢；set up before the ticket
  // fetch so a failure there (e.g. electrum error) can't prevent it from starting.
  setInterval(() => contractStore.refreshHot(), 60_000)
  // Tier 2（冷資料，RSC/JP/FPP/latestWN/DrawingNFT/WN-at-JP）：排程閘控輪詢，
  // 頻率依離下一個輪次狀態轉換還有多久動態調整，見 lib/roundSchedule.ts
  contractStore.startColdSchedule()
  if (walletStore.address) {
    try {
      await ticketStore.fetchForAddress(walletStore.address)
    } catch (err) {
      console.error('[App] Failed to fetch player tickets:', err)
    }
  }
})
</script>

<style>
.nav-link {
  @apply text-gray-400 hover:text-bch transition whitespace-nowrap shrink-0;
}
.router-link-active.nav-link {
  @apply text-white border-b-2 border-bch pb-1;
}
</style>
