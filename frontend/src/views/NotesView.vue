<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Pencil, Plus, Search, StickyNote, Trash2, User } from 'lucide-vue-next';
import { useAuthStore } from '../stores/auth';
import { useLocale } from '../composables/useLocale';
import { api, errorMessage } from '../services/api';
import AppButton from '../components/ui/AppButton.vue';
import AppInput from '../components/ui/AppInput.vue';
import AppSelect from '../components/ui/AppSelect.vue';
import LoadingState from '../components/ui/LoadingState.vue';
import AppModal from '../components/modals/AppModal.vue';
import ConfirmDialog from '../components/modals/ConfirmDialog.vue';

type NoteCategory = 'MEMBER' | 'LOAN' | 'DUES' | 'BUSINESS' | 'INVESTMENT' | 'OTHER';

interface NoteItem {
  id: string;
  category: NoteCategory;
  title: string;
  content: string;
  memberId: string | null;
  createdAt: string;
  updatedAt: string;
  member: { id: string; memberNo: string; fullName: string } | null;
  createdBy: { id: string; name: string };
  updatedBy: { id: string; name: string } | null;
}

interface NoteListResponse {
  items: NoteItem[];
  total: number;
  allCount: number;
  page: number;
  pageSize: number;
  categoryCounts: Record<NoteCategory, number>;
}

interface MemberOption {
  id: string;
  memberNo: string;
  fullName: string;
}

const categoryList: { value: NoteCategory; label: string }[] = [
  { value: 'MEMBER', label: 'Member' },
  { value: 'LOAN', label: 'Loan' },
  { value: 'DUES', label: 'Dues & Payables' },
  { value: 'BUSINESS', label: 'Business' },
  { value: 'INVESTMENT', label: 'Investment' },
  { value: 'OTHER', label: 'Others' },
];

const categoryLabels: Record<NoteCategory, string> = {
  MEMBER: 'Member',
  LOAN: 'Loan',
  DUES: 'Dues & Payables',
  BUSINESS: 'Business',
  INVESTMENT: 'Investment',
  OTHER: 'Others',
};

const timestamp = new Intl.DateTimeFormat('en-BD', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Dhaka',
});

const auth = useAuthStore();
const { t } = useLocale();

const canWrite = computed(() => auth.can('notes.write'));
const canDelete = computed(() => auth.can('notes.delete'));
const canReadMembers = computed(() => auth.can('members.read'));

const notes = ref<NoteItem[]>([]);
const total = ref(0);
const allCount = ref(0);
const page = ref(1);
const pageSize = 18;
const categoryCounts = ref<Record<NoteCategory, number>>({
  MEMBER: 0,
  LOAN: 0,
  DUES: 0,
  BUSINESS: 0,
  INVESTMENT: 0,
  OTHER: 0,
});

const selectedCategory = ref<'' | NoteCategory>('');
const search = ref('');
const loading = ref(false);
const error = ref('');
const notice = ref('');

const members = ref<MemberOption[]>([]);
const membersLoaded = ref(false);

const editorOpen = ref(false);
const editingNote = ref<NoteItem | null>(null);
const saving = ref(false);
const formError = ref('');
const formCategory = ref<NoteCategory>('OTHER');
const formTitle = ref('');
const formContent = ref('');
const formMemberId = ref('');

const deleteTarget = ref<NoteItem | null>(null);
const deleting = ref(false);
const deleteError = ref('');

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

const categoryOptions = computed(() =>
  categoryList.map(item => ({ value: item.value, label: t(item.label) })),
);

const memberOptions = computed(() => [
  { value: '', label: t('None (general note)') },
  ...members.value.map(member => ({
    value: member.id,
    label: `${member.fullName} · ${member.memberNo}`,
  })),
]);

let requestSeq = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

async function loadNotes(targetPage = page.value) {
  const current = ++requestSeq;
  loading.value = true;
  error.value = '';
  try {
    const { data } = await api.get<NoteListResponse>('/notes', {
      params: {
        category: selectedCategory.value || undefined,
        search: search.value.trim() || undefined,
        page: targetPage,
        pageSize,
      },
    });
    if (current !== requestSeq) return;
    notes.value = data.items;
    total.value = data.total;
    allCount.value = data.allCount;
    page.value = data.page;
    categoryCounts.value = data.categoryCounts;
  } catch (e) {
    if (current === requestSeq) error.value = errorMessage(e);
  } finally {
    if (current === requestSeq) loading.value = false;
  }
}

async function ensureMembersLoaded() {
  if (membersLoaded.value || !canReadMembers.value) return;
  try {
    const { data } = await api.get<{ items: MemberOption[] }>('/members', {
      params: { page: 1, pageSize: 100 },
    });
    members.value = data.items ?? [];
    membersLoaded.value = true;
  } catch {
    // Non-blocking: admin can still write notes without linking a member.
  }
}

function selectCategory(category: '' | NoteCategory) {
  selectedCategory.value = category;
  void loadNotes(1);
}

watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    void loadNotes(1);
  }, 260);
});

async function openCreate() {
  editingNote.value = null;
  formCategory.value = selectedCategory.value || 'OTHER';
  formTitle.value = '';
  formContent.value = '';
  formMemberId.value = '';
  formError.value = '';
  editorOpen.value = true;
  await ensureMembersLoaded();
}

async function openEdit(note: NoteItem) {
  editingNote.value = note;
  formCategory.value = note.category;
  formTitle.value = note.title;
  formContent.value = note.content;
  formMemberId.value = note.memberId ?? '';
  formError.value = '';
  editorOpen.value = true;
  await ensureMembersLoaded();
}

function closeEditor() {
  if (saving.value) return;
  editorOpen.value = false;
}

async function saveNote() {
  const title = formTitle.value.trim();
  const content = formContent.value.trim();
  if (!title) {
    formError.value = t('Title is required');
    return;
  }
  if (!content) {
    formError.value = t('Note content is required');
    return;
  }
  saving.value = true;
  formError.value = '';
  notice.value = '';
  try {
    const payload = {
      category: formCategory.value,
      title,
      content,
      memberId: formMemberId.value || null,
    };
    if (editingNote.value) {
      await api.put(`/notes/${editingNote.value.id}`, payload);
      notice.value = t('Note updated.');
    } else {
      await api.post('/notes', payload);
      notice.value = t('Note saved.');
    }
    editorOpen.value = false;
    await loadNotes(editingNote.value ? page.value : 1);
  } catch (e) {
    formError.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

function requestDelete(note: NoteItem) {
  deleteTarget.value = note;
  deleteError.value = '';
}

function closeDelete() {
  if (deleting.value) return;
  deleteTarget.value = null;
  deleteError.value = '';
}

async function confirmDelete() {
  if (!deleteTarget.value) return;
  deleting.value = true;
  deleteError.value = '';
  notice.value = '';
  try {
    await api.delete(`/notes/${deleteTarget.value.id}`);
    deleteTarget.value = null;
    notice.value = t('Note deleted.');
    const nextPage = notes.value.length === 1 && page.value > 1 ? page.value - 1 : page.value;
    await loadNotes(nextPage);
  } catch (e) {
    deleteError.value = errorMessage(e);
  } finally {
    deleting.value = false;
  }
}

onMounted(() => {
  void loadNotes(1);
});
</script>

<template>
  <div class="page-heading">
    <div>
      <h1>{{ t('Notes') }}<span class="heading-dot">.</span></h1>
      <p>{{ t('Keep track of member reminders, loans, dues, business, investments, or other notes.') }}</p>
    </div>
    <AppButton v-if="canWrite" @click="openCreate">
      <Plus :size="17" />
      {{ t('Add note') }}
    </AppButton>
  </div>

  <div v-if="notice" class="alert success" role="status">{{ notice }}</div>
  <div v-if="error" class="alert error" role="alert">{{ error }}</div>

  <section class="panel notes-toolbar">
    <div class="notes-tabs" role="tablist" :aria-label="t('Note categories')">
      <button
        type="button"
        role="tab"
        :aria-selected="selectedCategory === ''"
        :class="['note-tab', { active: selectedCategory === '' }]"
        @click="selectCategory('')"
      >
        <span>{{ t('All') }}</span>
        <span class="note-tab-count">{{ allCount }}</span>
      </button>
      <button
        v-for="item in categoryList"
        :key="item.value"
        type="button"
        role="tab"
        :aria-selected="selectedCategory === item.value"
        :class="['note-tab', { active: selectedCategory === item.value }]"
        @click="selectCategory(item.value)"
      >
        <span>{{ t(item.label) }}</span>
        <span class="note-tab-count">{{ categoryCounts[item.value] ?? 0 }}</span>
      </button>
    </div>

    <div class="notes-search-row">
      <label class="search-field">
        <Search :size="17" />
        <input
          v-model="search"
          type="search"
          :placeholder="t('Search notes by title, content, or member...')"
          :aria-label="t('Search notes')"
        >
      </label>
    </div>
  </section>

  <LoadingState v-if="loading && !notes.length" :message="t('Loading notes…')" />

  <section v-else-if="!notes.length" class="panel empty-state notes-empty">
    <StickyNote :size="36" />
    <h3>{{ t('No notes yet') }}</h3>
    <p>
      {{
        search.trim() || selectedCategory
          ? t('No notes match your current filter.')
          : t('Create your first note to track loans, dues, business, investments, or reminders.')
      }}
    </p>
    <AppButton v-if="canWrite && !search.trim()" @click="openCreate">
      <Plus :size="16" />
      {{ t('Add note') }}
    </AppButton>
  </section>

  <section v-else class="notes-grid">
    <article v-for="note in notes" :key="note.id" class="panel note-card">
      <div class="note-card-top">
        <span :class="['note-category-badge', `cat-${note.category.toLowerCase()}`]">
          {{ t(categoryLabels[note.category]) }}
        </span>
        <div v-if="canWrite || canDelete" class="note-card-actions">
          <button
            v-if="canWrite"
            type="button"
            class="icon-button"
            :title="t('Edit note')"
            :aria-label="`${t('Edit note')}: ${note.title}`"
            @click="openEdit(note)"
          >
            <Pencil :size="16" />
          </button>
          <button
            v-if="canDelete"
            type="button"
            class="icon-button note-delete-btn"
            :title="t('Delete note')"
            :aria-label="`${t('Delete note')}: ${note.title}`"
            @click="requestDelete(note)"
          >
            <Trash2 :size="16" />
          </button>
        </div>
      </div>

      <h2 class="note-card-title">{{ note.title }}</h2>

      <RouterLink
        v-if="note.member && canReadMembers"
        :to="`/members/${note.member.id}`"
        class="note-member-chip"
      >
        <User :size="14" />
        <span>{{ note.member.fullName }} · {{ note.member.memberNo }}</span>
      </RouterLink>
      <div v-else-if="note.member" class="note-member-chip">
        <User :size="14" />
        <span>{{ note.member.fullName }} · {{ note.member.memberNo }}</span>
      </div>

      <p class="note-card-body preserve-lines">{{ note.content }}</p>

      <footer class="note-card-footer">
        <span>{{ note.updatedBy?.name ?? note.createdBy.name }}</span>
        <time :datetime="note.updatedAt">{{ timestamp.format(new Date(note.updatedAt)) }}</time>
      </footer>
    </article>
  </section>

  <div v-if="total > pageSize" class="panel table-footer notes-pagination">
    <span>{{ t('Page') }} {{ page }} / {{ totalPages }} ({{ total }})</span>
    <div class="button-row">
      <AppButton variant="secondary" :disabled="loading || page <= 1" @click="loadNotes(page - 1)">
        {{ t('Previous') }}
      </AppButton>
      <AppButton variant="secondary" :disabled="loading || page >= totalPages" @click="loadNotes(page + 1)">
        {{ t('Next') }}
      </AppButton>
    </div>
  </div>

  <AppModal
    :open="editorOpen"
    :title="editingNote ? t('Edit note') : t('Add note')"
    :description="t('Record any reminder for members, loans, dues, business, investments, or others.')"
    :busy="saving"
    @close="closeEditor"
  >
    <form class="app-form" @submit.prevent="saveNote">
      <div v-if="formError" class="alert error" role="alert">{{ formError }}</div>

      <AppSelect v-model="formCategory" :label="t('Category')" :options="categoryOptions" />

      <AppSelect
        v-if="canReadMembers"
        v-model="formMemberId"
        :label="t('Related member (optional)')"
        :options="memberOptions"
      />

      <AppInput
        v-model="formTitle"
        :label="t('Title')"
        :placeholder="t('e.g. Loan commitment or dues reminder')"
        maxlength="160"
        required
      />

      <label class="field">
        <span>{{ t('Note') }}</span>
        <textarea
          v-model="formContent"
          rows="6"
          maxlength="10000"
          :placeholder="t('Write details here...')"
          required
        ></textarea>
      </label>

      <div class="form-actions">
        <AppButton variant="secondary" :disabled="saving" @click="closeEditor">
          {{ t('Cancel') }}
        </AppButton>
        <AppButton type="submit" :loading="saving">
          {{ editingNote ? t('Save changes') : t('Save note') }}
        </AppButton>
      </div>
    </form>
  </AppModal>

  <ConfirmDialog
    :open="!!deleteTarget"
    :title="t('Delete note?')"
    :message="deleteTarget ? `${t('Are you sure you want to permanently delete')} “${deleteTarget.title}”?` : ''"
    :confirm-label="t('Delete note')"
    :cancel-label="t('Cancel')"
    confirm-variant="danger"
    :busy="deleting"
    :error="deleteError"
    @close="closeDelete"
    @confirm="confirmDelete"
  />
</template>

<style scoped>
.notes-toolbar {
  padding: 18px 20px;
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.notes-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.note-tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-subtle);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 550;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.note-tab:hover {
  background: var(--surface-hover);
}

.note-tab.active {
  background: var(--accent-subtle);
  border-color: var(--accent-border);
  color: var(--accent);
}

.note-tab-count {
  font-size: 12px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-muted);
}

.note-tab.active .note-tab-count {
  background: var(--accent);
  color: var(--primary-text);
}

.notes-search-row {
  display: flex;
  gap: 12px;
}

.notes-empty {
  margin-top: 12px;
}

.notes-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
  gap: 18px;
}

.note-card {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.note-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.note-card-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.note-delete-btn:hover {
  color: var(--danger-text);
  background: var(--danger-bg);
}

.note-category-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  background: var(--surface-hover);
  color: var(--text-secondary);
}

.note-category-badge.cat-member {
  background: var(--accent-subtle);
  color: var(--accent);
}

.note-category-badge.cat-loan {
  background: var(--warning-bg);
  color: var(--warning-text);
}

.note-category-badge.cat-dues {
  background: var(--danger-bg);
  color: var(--danger-text);
}

.note-category-badge.cat-business {
  background: var(--success-bg);
  color: var(--success-text);
}

.note-category-badge.cat-investment {
  background: var(--accent-bg);
  color: var(--accent);
}

.note-card-title {
  font-size: 17px;
  line-height: 1.35;
  color: var(--text);
  overflow-wrap: anywhere;
}

.note-member-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  max-width: 100%;
  padding: 4px 9px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 550;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  color: var(--text-secondary);
}

a.note-member-chip:hover {
  border-color: var(--accent-border);
  color: var(--accent);
}

.note-card-body {
  font-size: 14px;
  line-height: 1.65;
  color: var(--text-secondary);
  flex: 1;
}

.note-card-footer {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  color: var(--text-muted);
}

.notes-pagination {
  margin-top: 18px;
}

@media (max-width: 640px) {
  .notes-grid {
    grid-template-columns: 1fr;
  }
}
</style>
