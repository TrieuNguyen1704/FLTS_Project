<script setup>
import { computed } from 'vue'

const props = defineProps({
  status: {
    type: String,
    required: true,
  },
  label: {
    type: String,
    default: '',
  },
})

// Định nghĩa màu sắc và nhãn hiển thị mặc định theo status mã
const statusConfig = {
  // Trạng thái tài liệu
  uploaded_pending_processing: {
    label: 'Chờ xử lý AI',
    classes: 'bg-amber-50 text-amber-700 border-amber-200',
    dot: 'bg-amber-500',
  },
  processing: {
    label: 'Đang xử lý',
    classes: 'bg-blue-50 text-blue-700 border-blue-200',
    dot: 'bg-blue-500 animate-pulse',
  },
  processed: {
    label: 'Đã hoàn tất',
    classes: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dot: 'bg-emerald-500',
  },
  failed: {
    label: 'Thất bại',
    classes: 'bg-red-50 text-red-700 border-red-200',
    dot: 'bg-red-500',
  },
  // Trạng thái chung
  active: {
    label: 'Đang hoạt động',
    classes: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dot: 'bg-emerald-500',
  },
  inactive: {
    label: 'Tạm khóa',
    classes: 'bg-slate-100 text-slate-600 border-slate-200',
    dot: 'bg-slate-400',
  },
  draft: {
    label: 'Bản nháp',
    classes: 'bg-slate-100 text-slate-700 border-slate-200',
    dot: 'bg-slate-500',
  },
}

const currentConfig = computed(() => {
  return (
    statusConfig[props.status] || {
      label: props.label || props.status,
      classes: 'bg-slate-100 text-slate-700 border-slate-200',
      dot: 'bg-slate-400',
    }
  )
})

const displayLabel = computed(() => props.label || currentConfig.value.label)
</script>

<template>
  <span
    :class="[
      'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border',
      currentConfig.classes,
    ]"
  >
    <span :class="['w-1.5 h-1.5 rounded-full shrink-0', currentConfig.dot]" />
    {{ displayLabel }}
  </span>
</template>
