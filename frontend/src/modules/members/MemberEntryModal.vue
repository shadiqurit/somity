<script setup lang="ts">
import { ref } from 'vue';
import AppModal from '../../components/modals/AppModal.vue';
import MemberEditor from './MemberEditor.vue';
import type { Member } from './types';
defineProps<{ open: boolean; memberId?: string }>();
defineEmits<{ close: []; saved: [member: Member, photoError?: string] }>();
const busy = ref(false);
</script>
<template>
  <AppModal :open="open" :title="memberId ? 'Edit member' : 'Add member'" description="Add personal information and nominees to keep this member’s profile complete." size="wide" :busy="busy" @close="$emit('close')">
    <MemberEditor v-if="open" :key="memberId ?? 'new'" :member-id="memberId" @busy="busy = $event" @cancel="$emit('close')" @saved="(member, photoError) => $emit('saved', member, photoError)" />
  </AppModal>
</template>
