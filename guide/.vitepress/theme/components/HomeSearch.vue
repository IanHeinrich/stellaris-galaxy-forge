<script setup lang="ts">
import { openSearch } from '../openSearch'
</script>

<template>
  <div class="HomeSearch">
    <button type="button" class="box" aria-label="Search the guide" @click="openSearch">
      <span class="vpi-search icon" aria-hidden="true"></span>
      <span class="placeholder">Search the guide…</span>
      <kbd class="hint">Ctrl K</kbd>
    </button>
  </div>
</template>

<style scoped>
.HomeSearch {
  margin: 0 auto;
  padding: 0 24px 48px;
  max-width: 1152px;
}

@media (min-width: 640px) {
  .HomeSearch {
    padding: 0 48px 56px;
  }
}

@media (min-width: 960px) {
  .HomeSearch {
    padding: 0 64px 64px;
  }
}

.box {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 640px;
  padding: 14px 18px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background-color: var(--vp-c-bg-alt);
  color: var(--vp-c-text-2);
  font-size: 18px;
  text-align: left;
  cursor: text;
  transition: border-color 0.25s;
}

.box:hover,
.box:focus-visible {
  border-color: var(--vp-c-brand-1);
}

.icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
}

.placeholder {
  flex-grow: 1;
}

.hint {
  font-size: 12px;
}

@media (max-width: 639px) {
  .hint {
    display: none;
  }
}
</style>
