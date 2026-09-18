<template>
  <span
    class="number-ball"
    :class="color === 'green' ? 'number-ball-green' : 'number-ball-purple'"
  >
    {{ number < 10 ? '0' + number : number }}
  </span>
</template>

<script setup lang="ts">
defineProps<{
  number: number
  color: 'green' | 'purple'
}>()
</script>
