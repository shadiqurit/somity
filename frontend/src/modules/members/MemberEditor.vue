<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Check, Pencil, Plus, ShieldCheck, Trash2, UserRound, Users } from 'lucide-vue-next';
import { api, errorMessage } from '../../services/api';
import { statusOptions, type Member, type Nominee } from './types';
import AppForm from '../../components/forms/AppForm.vue';
import AppInput from '../../components/ui/AppInput.vue';
import AppSelect from '../../components/ui/AppSelect.vue';
import AppDatePicker from '../../components/ui/AppDatePicker.vue';
import AppButton from '../../components/ui/AppButton.vue';
import AppModal from '../../components/modals/AppModal.vue';
import FileUploader from '../../components/forms/FileUploader.vue';
import LoadingState from '../../components/ui/LoadingState.vue';

const props = defineProps<{ memberId?: string }>();
const emit = defineEmits<{ saved: [member: Member, photoError?: string]; cancel: []; busy: [value: boolean] }>();
const isEdit = computed(() => !!props.memberId);
const loading = ref(false); const busy = ref(false); const error = ref('');
const loaded = ref(!isEdit.value); const photo = ref<File>(); const formElement = ref<HTMLElement>();
const existingPhotoId = ref<string>(); const removeExistingPhoto = ref(false);
const emptyNominee = (): Nominee => ({ fullName: '', relationship: '', phone: '', address: '', sharePercent: '100' });
const form = ref({ fullName: '', phone: '', email: '', address: '', joinedAt: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), status: 'ACTIVE', nominees: [] as Nominee[], version: 1 });
const shareTotal = computed(() => form.value.nominees.reduce((sum, n) => sum + Math.round(Number(n.sharePercent) * 100), 0) / 100);
const nomineeOpen = ref(false); const nomineeIndex = ref<number | null>(null); const nomineeDraft = ref(emptyNominee()); const nomineeError = ref('');
function openNominee(index: number | null = null) {
  nomineeIndex.value = index;
  nomineeDraft.value = index === null ? { ...emptyNominee(), sharePercent: shareTotal.value < 100 ? String((10000 - Math.round(shareTotal.value * 100)) / 100) : '' } : { ...form.value.nominees[index]! };
  nomineeError.value = ''; nomineeOpen.value = true;
}
function saveNominee() {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(nomineeDraft.value.sharePercent) || Number(nomineeDraft.value.sharePercent) <= 0 || Number(nomineeDraft.value.sharePercent) > 100) { nomineeError.value = 'Enter a share between 0.01 and 100, with at most two decimal places.'; return; }
  const nominee = { ...nomineeDraft.value };
  if (nomineeIndex.value === null) form.value.nominees.push(nominee); else form.value.nominees[nomineeIndex.value] = nominee;
  nomineeOpen.value = false;
}
async function load() {
  if (!props.memberId) return;
  loading.value = true; error.value = '';
  try {
    const { data } = await api.get<Member>(`/members/${props.memberId}`);
    existingPhotoId.value = data.documents[0]?.id;
    form.value = { fullName: data.fullName, phone: data.phone, email: data.email ?? '', address: data.address, joinedAt: data.joinedAt.slice(0, 10), status: data.status, version: data.version, nominees: data.nominees.map(n => ({ fullName: n.fullName, phone: n.phone, address: n.address, relationship: n.relationship, sharePercent: n.sharePercent })) };
    loaded.value = true;
  } catch (e) { error.value = errorMessage(e); } finally { loading.value = false; }
}
async function submit() {
  if (!form.value.nominees.length || shareTotal.value !== 100) { error.value = 'Add at least one nominee and make sure the combined shares total exactly 100%.'; formElement.value?.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
  busy.value = true; emit('busy', true); error.value = '';
  try {
    const { version, ...input } = form.value;
    const { data } = props.memberId ? await api.put<Member>(`/members/${props.memberId}`, { ...input, version }) : await api.post<Member>('/members', input);
    let photoError: string | undefined;
    if (photo.value) {
      try { const body = new FormData(); body.append('photo', photo.value); await api.post(`/members/${data.id}/photo`, body); }
      catch (e) { photoError = errorMessage(e); }
    } else if (removeExistingPhoto.value && existingPhotoId.value) {
      try { await api.delete(`/members/${data.id}/photo`, { data: { documentId: existingPhotoId.value } }); }
      catch (e) { photoError = `Photo removal failed: ${errorMessage(e)}`; }
    }
    emit('saved', data, photoError);
  } catch (e) { error.value = errorMessage(e); formElement.value?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  finally { busy.value = false; emit('busy', false); }
}
onMounted(load);
</script>

<template>
  <div ref="formElement">
    <LoadingState v-if="loading" />
    <div v-else-if="!loaded" class="alert error" role="alert">{{ error }} <AppButton variant="ghost" @click="load">Retry</AppButton></div>
    <AppForm v-else :error="error" :busy="busy" @submit="submit">
      <section class="entry-section">
        <div class="section-heading"><span class="entry-section-icon"><UserRound :size="22" /></span><div><h3>Personal information</h3><p>Contact details and membership information.</p></div></div>
        <div class="form-grid">
          <AppInput v-model="form.fullName" label="Full name" placeholder="Enter the member’s full name" required minlength="2" maxlength="120" autocomplete="name" />
          <AppInput v-model="form.phone" label="Phone number" type="tel" placeholder="+880 1XXXXXXXXX" required maxlength="25" autocomplete="tel" />
          <AppInput v-model="form.email" label="Email address (optional)" type="email" placeholder="member@example.com" maxlength="191" autocomplete="email" />
          <AppDatePicker v-model="form.joinedAt" label="Membership date" />
          <AppSelect v-model="form.status" label="Membership status" :options="statusOptions" />
          <label class="field full-span"><span>Address</span><textarea v-model="form.address" placeholder="House, road, area and district" required minlength="3" maxlength="500" rows="2" autocomplete="street-address"></textarea></label>
        </div>
        <FileUploader :document-id="existingPhotoId" :name="form.fullName" :removed="removeExistingPhoto" @selected="photo = $event; removeExistingPhoto = false" @cleared="photo = undefined" @remove="photo = undefined; removeExistingPhoto = true" @restore="removeExistingPhoto = false" />
      </section>
      <section class="entry-section nominee-section">
        <div class="nominee-section-heading"><div class="section-heading"><span class="entry-section-icon"><Users :size="22" /></span><div><h3>Nominees <span class="count-pill">{{ form.nominees.length }}</span></h3><p>Add the people nominated by this member.</p></div></div><AppButton v-if="form.nominees.length < 10" variant="secondary" @click="openNominee()"><Plus :size="18" /> Add nominee</AppButton></div>
        <div v-if="!form.nominees.length" class="nominee-empty"><Users :size="28" /><div><strong>No nominees added yet</strong><p>Add at least one nominee. Their combined shares must total 100%.</p></div></div>
        <div v-else class="nominee-list">
          <article v-for="(nominee, index) in form.nominees" :key="index" class="nominee-list-item">
            <span class="nominee-number">{{ String(index + 1).padStart(2, '0') }}</span>
            <div class="nominee-person"><strong>{{ nominee.fullName }}</strong><span>{{ nominee.relationship }} · {{ nominee.phone }}</span></div>
            <span class="share-badge">{{ nominee.sharePercent }}%</span>
            <div class="button-row"><button type="button" class="icon-button" :aria-label="`Edit nominee ${index + 1}`" @click="openNominee(index)"><Pencil :size="18" /></button><button type="button" class="icon-button remove-button" :aria-label="`Remove nominee ${index + 1}`" @click="form.nominees.splice(index, 1)"><Trash2 :size="18" /></button></div>
          </article>
        </div>
        <div :class="['share-total', { complete: shareTotal === 100 }]"><span><Check v-if="shareTotal === 100" :size="17" /><ShieldCheck v-else :size="17" />Total nominee allocation</span><strong>{{ shareTotal.toFixed(2) }} / 100%</strong></div>
      </section>
      <div class="form-actions entry-actions"><span class="entry-hint">Review the details before saving.</span><AppButton variant="secondary" @click="$emit('cancel')">Cancel</AppButton><AppButton type="submit" :loading="busy">{{ isEdit ? 'Save changes' : 'Create member' }}</AppButton></div>
    </AppForm>
  </div>
  <AppModal :open="nomineeOpen" :title="nomineeIndex === null ? 'Add nominee' : 'Edit nominee'" description="Enter nominee details, then save them to the member’s nominee list." @close="nomineeOpen = false">
    <AppForm :error="nomineeError" @submit="saveNominee">
      <AppInput v-model="nomineeDraft.fullName" label="Nominee full name" placeholder="Enter full name" required minlength="2" maxlength="120" />
      <div class="form-grid"><AppInput v-model="nomineeDraft.relationship" label="Relationship" placeholder="e.g. Spouse, daughter" required minlength="2" maxlength="80" /><AppInput v-model="nomineeDraft.sharePercent" label="Share (%)" type="number" min="0.01" max="100" step="0.01" required /></div>
      <AppInput v-model="nomineeDraft.phone" label="Nominee phone" type="tel" placeholder="+880 1XXXXXXXXX" required maxlength="25" />
      <label class="field"><span>Nominee address</span><textarea v-model="nomineeDraft.address" placeholder="Enter the nominee’s address" required minlength="3" maxlength="500" rows="2"></textarea></label>
      <div class="form-actions"><AppButton variant="secondary" @click="nomineeOpen = false">Cancel</AppButton><AppButton type="submit">{{ nomineeIndex === null ? 'Add to nominee list' : 'Save nominee' }}</AppButton></div>
    </AppForm>
  </AppModal>
</template>
