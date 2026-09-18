<template>
  <div>
    <div
      class="grid gap-2"
      :class="mode === 'normal' ? 'grid-cols-6 sm:grid-cols-8' : 'grid-cols-6 sm:grid-cols-8'"
    >
      <button
        v-for="n in total"
        :key="n"
        type="button"
        @click="toggle(n)"
        :class="[
          'number-btn h-11 w-full rounded-lg border font-mono text-sm font-bold',
          mode === 'normal'
            ? isSelected(n)
              ? 'selected border-bch/50'
              : 'border-white/10 text-gray-500 hover:border-bch/50 hover:text-bch bg-white/5'
            : isSelected(n)
              ? 'special-selected border-purple-400/50'
              : 'border-white/10 text-gray-500 hover:border-purple-400/50 hover:text-purple-400 bg-white/5',
        ]"
      >
        {{ n < 10 ? '0' + n : n }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  mode: 'normal' | 'special'
  modelValue: number[]
}>()

const emit = defineEmits<{
  'update:modelValue': [numbers: number[]]
}>()

const total = props.mode === 'normal' ? 32 : 16
const maxPicks = props.mode === 'normal' ? 3 : 1

function isSelected(n: number): boolean {
  return props.modelValue.includes(n)
}

function toggle(n: number): void {
  if (isSelected(n)) {
    emit('update:modelValue', props.modelValue.filter(x => x !== n))
    return
  }

  if (props.mode === 'special') {
    emit('update:modelValue', [n])
    return
  }

  if (props.modelValue.length < maxPicks) {
    emit('update:modelValue', [...props.modelValue, n])
    return
  }

  // 已選滿:自動取消離新號碼最近的號碼,距離相同則取消較大的號碼
  let removeIndex = 0
  for (let i = 1; i < props.modelValue.length; i++) {
    const current = props.modelValue[i]
    const best = props.modelValue[removeIndex]
    const currentDiff = Math.abs(current - n)
    const bestDiff = Math.abs(best - n)
    if (currentDiff < bestDiff || (currentDiff === bestDiff && current > best)) {
      removeIndex = i
    }
  }
  emit('update:modelValue', [
    ...props.modelValue.filter((_, i) => i !== removeIndex),
    n,
  ])
}
</script>
