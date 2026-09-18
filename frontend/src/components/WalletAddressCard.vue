<template>
  <div class="bg-black/30 rounded-2xl p-4">
    <div class="text-xs text-gray-500 mb-0.5">{{ label }}</div>
    <div class="text-[11px] text-gray-600 mb-2">{{ hint }}</div>
    <div class="font-mono text-xs text-white/80 break-all leading-relaxed select-all mb-3">{{ address }}</div>

    <div v-if="showQr && qrDataUrl" class="flex justify-center mb-3">
      <img :src="qrDataUrl" alt="QR Code" class="rounded-xl" width="160" height="160" />
    </div>

    <div class="flex items-center gap-4">
      <button
        class="flex items-center gap-1.5 text-xs font-semibold transition text-bch hover:text-bch/80"
        @click="toggleQr"
      >
        <i :class="showQr ? 'fa-solid fa-eye-slash' : 'fa-solid fa-qrcode'" />
        {{ showQr ? t('wallet.hide_qr') : t('wallet.show_qr') }}
      </button>
      <button
        class="flex items-center gap-1.5 text-xs font-semibold transition"
        :class="copied ? 'text-green-400' : 'text-bch hover:text-bch/80'"
        @click="copyAddress"
      >
        <i :class="copied ? 'fa-solid fa-circle-check' : 'fa-regular fa-copy'" />
        {{ copied ? t('wallet.copied') : t('wallet.copy_address') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import QRCode from 'qrcode'
import { useToast } from '@/composables/useToast'

const props = defineProps<{
  label: string
  hint: string
  address: string
}>()

const { t } = useI18n()
const { showToast } = useToast()

const showQr = ref(false)
const qrDataUrl = ref('')
const copied = ref(false)

async function toggleQr() {
  if (!props.address) return
  if (!showQr.value && !qrDataUrl.value) {
    qrDataUrl.value = await QRCode.toDataURL(props.address, { width: 200, margin: 1 })
  }
  showQr.value = !showQr.value
}

function copyViaExecCommand(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(textarea)
  return ok
}

async function copyAddress() {
  if (!props.address) return
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(props.address)
    } else if (!copyViaExecCommand(props.address)) {
      throw new Error('execCommand copy failed')
    }
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    if (copyViaExecCommand(props.address)) {
      copied.value = true
      setTimeout(() => { copied.value = false }, 2000)
    } else {
      showToast(t('wallet.copy_failed'), 'error')
    }
  }
}
</script>
