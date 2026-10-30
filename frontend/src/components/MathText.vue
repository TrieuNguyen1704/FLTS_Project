<script setup>
// Hiển thị văn bản có công thức LaTeX. HTML chỉ đến từ renderMathText (chữ thường đã escape, toán do KaTeX trust:false).
// Không có công thức thì render text node thuần (Vue tự escape), không dùng v-html.
// CSS của KaTeX được import một lần ở main.js.
import { computed } from 'vue'
import { hasMath, renderMathText } from '@/quiz/mathRender'

const props = defineProps({
  text: { type: String, default: '' },
  tag: { type: String, default: 'span' },
})

const html = computed(() => (hasMath(props.text) ? renderMathText(props.text) : null))
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- nội dung đã escape/sanitize trong renderMathText -->
  <component :is="tag" v-if="html !== null" class="math-text whitespace-pre-wrap break-words" v-html="html" />
  <component :is="tag" v-else class="math-text whitespace-pre-wrap break-words">{{ text }}</component>
</template>
