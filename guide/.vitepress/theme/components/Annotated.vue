<!--
Numbered marks over a screenshot, with a legend below it. The image goes in
the slot as a Markdown image, so VitePress bundles it and a wrong path fails
the build. Keep the blank lines around the image, or it stays raw text.
x, y and box are in the image's own pixels, and the size is read from the
loaded image. A mark with a box and no x, y has its number at the box's
top-left corner. :legend="false" leaves the legend out, for a page whose
own numbered list explains the marks.

<Annotated :marks="[
  { n: 1, x: 690, y: 8, label: 'Scenario layers' },
  { n: 2, box: [1246, 108, 340, 840], label: 'Galaxy page' }
]">

![The Galaxy Forge window](../images/scenario/scenario-window.png)

</Annotated>
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

interface Mark {
  n: number
  label: string
  x?: number
  y?: number
  box?: [number, number, number, number]
}

const props = withDefaults(defineProps<{ marks: Mark[]; legend?: boolean }>(), { legend: true })

const frame = ref<HTMLElement | null>(null)
const size = ref<{ width: number; height: number } | null>(null)
const active = ref<number | null>(null)

const rows = computed(() => [...props.marks].sort((a, b) => a.n - b.n))

function percent(value: number, whole: number) {
  return `${(value / whole) * 100}%`
}

function markerStyle(mark: Mark) {
  const { width, height } = size.value!
  const x = mark.x ?? mark.box?.[0] ?? 0
  const y = mark.y ?? mark.box?.[1] ?? 0
  return { left: percent(x, width), top: percent(y, height) }
}

function boxStyle(box: [number, number, number, number]) {
  const { width, height } = size.value!
  const [x, y, w, h] = box
  return {
    left: percent(x, width),
    top: percent(y, height),
    width: percent(w, width),
    height: percent(h, height)
  }
}

let image: HTMLImageElement | null = null

function readSize() {
  if (image && image.naturalWidth > 0) {
    size.value = { width: image.naturalWidth, height: image.naturalHeight }
  }
}

onMounted(() => {
  image = frame.value?.querySelector('img') ?? null
  if (!image) return
  image.addEventListener('load', readSize)
  readSize()
})

onBeforeUnmount(() => image?.removeEventListener('load', readSize))
</script>

<template>
  <figure class="Annotated">
    <div ref="frame" class="Annotated-frame">
      <slot />
      <div v-if="size" class="Annotated-overlay">
        <template v-for="mark in marks" :key="mark.n">
          <span
            v-if="mark.box"
            class="Annotated-box"
            :class="{ active: active === mark.n }"
            :style="boxStyle(mark.box)"
          />
          <button
            type="button"
            class="Annotated-marker"
            :class="{ active: active === mark.n }"
            :style="markerStyle(mark)"
            :aria-label="`${mark.n}: ${mark.label}`"
            @mouseenter="active = mark.n"
            @mouseleave="active = null"
            @focus="active = mark.n"
            @blur="active = null"
          >
            {{ mark.n }}
          </button>
        </template>
      </div>
    </div>
    <ol v-if="legend" class="Annotated-legend">
      <li
        v-for="mark in rows"
        :key="mark.n"
        :class="{ active: active === mark.n }"
        @mouseenter="active = mark.n"
        @mouseleave="active = null"
      >
        <span class="Annotated-badge">{{ mark.n }}</span>
        <span>{{ mark.label }}</span>
      </li>
    </ol>
  </figure>
</template>
