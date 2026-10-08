<script setup lang="ts">
import { withBase } from 'vitepress'
import { openSearch } from '../openSearch'
</script>

<template>
  <div class="NotFound">
    <h1 class="title">There is no page here</h1>
    <p class="text">Search the guide for what you were looking for, or start from the home page.</p>
    <div class="actions">
      <button type="button" class="action brand" @click="openSearch">Search the guide</button>
      <a class="action alt" :href="withBase('/')">Go to the home page</a>
    </div>
  </div>
</template>

<style scoped>
.NotFound {
  margin: 0 auto;
  padding: 64px 24px 96px;
  max-width: 560px;
  text-align: center;
}

@media (min-width: 768px) {
  .NotFound {
    padding: 96px 32px 168px;
  }
}

.title {
  font-size: 28px;
  font-weight: 700;
  line-height: 36px;
}

.text {
  margin-top: 16px;
  color: var(--vp-c-text-2);
  line-height: 26px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 28px;
}

.action {
  display: inline-block;
  border: 1px solid transparent;
  border-radius: 20px;
  padding: 0 20px;
  line-height: 38px;
  font-size: 14px;
  font-weight: 600;
  transition: color 0.25s, border-color 0.25s, background-color 0.25s;
}

.brand {
  border-color: var(--vp-button-brand-border);
  color: var(--vp-button-brand-text);
  background-color: var(--vp-button-brand-bg);
}

.brand:hover {
  background-color: var(--vp-button-brand-hover-bg);
}

.alt {
  border-color: var(--vp-button-alt-border);
  color: var(--vp-button-alt-text);
  background-color: var(--vp-button-alt-bg);
}

.alt:hover {
  background-color: var(--vp-button-alt-hover-bg);
}
</style>
