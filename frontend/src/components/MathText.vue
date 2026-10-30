<script setup>
// Hiển thị văn bản có công thức LaTeX. HTML chỉ đến từ renderMathText (chữ thường đã escape, toán do KaTeX trust:false).
// CSS của KaTeX được import một lần ở main.js.
import { computed } from 'vue'
import { renderMathText } from '@/quiz/mathRender'

const props = defineProps({
  text: { type: String, default: '' },
  tag: { type: String, default: 'span' },
})

const html = computed(() => renderMathText(props.text))
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- nội dung đã escape/sanitize trong renderMathText -->
  <component :is="tag" class="math-text whitespace-pre-wrap break-words" v-html="html" />
</template>
