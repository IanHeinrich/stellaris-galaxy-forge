<script setup lang="ts">
defineProps<{ text: string }>()
</script>

<template>
  <span class="GuideVersion">{{ text }}</span>
</template>

<style scoped>
.GuideVersion {
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  white-space: nowrap;
}

.VPNavScreenMenu .GuideVersion {
  padding: 12px 0;
  border-bottom: 1px solid var(--vp-c-divider);
  line-height: 24px;
  font-size: 14px;
}
</style>
