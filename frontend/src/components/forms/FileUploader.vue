<script setup lang="ts">
import { onBeforeUnmount, ref, useId } from 'vue';
import { ImagePlus, RotateCcw, Trash2, X } from 'lucide-vue-next';
import AppButton from '../ui/AppButton.vue';
import MemberAvatar from '../ui/MemberAvatar.vue';
defineProps<{ documentId?: string; name?: string; removed?: boolean }>();
const emit = defineEmits<{ selected: [file: File]; cleared: []; remove: []; restore: [] }>();
const error = ref(''); const id = useId(); const input = ref<HTMLInputElement>(); const preview = ref(''); const selectedName = ref('');
function clearSelection() {
  if (preview.value) URL.revokeObjectURL(preview.value);
  preview.value = ''; selectedName.value = ''; error.value = '';
  if (input.value) input.value.value = '';
  emit('cleared');
}
function select(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]; error.value = '';
  if (!file) return;
  if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    clearSelection(); error.value = 'Choose a JPG or PNG photo up to 5 MB.'; return;
  }
  if (preview.value) URL.revokeObjectURL(preview.value);
  preview.value = URL.createObjectURL(file); selectedName.value = file.name;
  emit('selected', file);
}
function remove() { clearSelection(); emit('remove'); }
onBeforeUnmount(() => { if (preview.value) URL.revokeObjectURL(preview.value); });
</script>
<template>
  <div class="upload-box">
    <div class="photo-field-heading">
      <span v-if="preview" class="photo-preview"><img :src="preview" alt="Selected member photo"></span>
      <MemberAvatar v-else-if="documentId && !removed" :name="name || 'Member'" :document-id="documentId" large />
      <span v-else class="photo-placeholder"><ImagePlus :size="28" /></span>
      <div><strong>Member photo</strong><p>{{ removed ? 'Photo will be removed when you save.' : selectedName || (documentId ? 'Choose a new photo to replace the current one.' : 'Add a photo to personalize this profile.') }}</p></div>
    </div>
    <label class="field" :for="id"><span class="sr-only">Member photo</span><input :id="id" ref="input" type="file" accept="image/jpeg,image/png" @change="select"></label>
    <div class="photo-field-actions">
      <small class="muted">JPG or PNG, up to 5 MB.</small>
      <AppButton v-if="preview" variant="ghost" @click="clearSelection"><X :size="16" /> Clear selection</AppButton>
      <AppButton v-if="documentId && !removed" variant="ghost" class="remove-button" @click="remove"><Trash2 :size="16" /> Remove photo</AppButton>
      <AppButton v-if="removed" variant="ghost" @click="$emit('restore')"><RotateCcw :size="16" /> Keep current photo</AppButton>
    </div>
    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
  </div>
</template>
