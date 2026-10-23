<template>
  <span class="tag" :class="`tag--${type}`">{{ text }}</span>
</template>

<script setup>
import { computed } from 'vue'
import { statusType } from '@/utils/dict'

const props = defineProps({
  domain: { type: String, required: true },
  value: { type: [String, Number], default: '' }
})
const type = computed(() => statusType(props.domain, props.value))
const text = computed(() => props.value || '-')
</script>
