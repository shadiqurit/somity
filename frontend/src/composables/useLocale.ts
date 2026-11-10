import { ref } from 'vue';
const locale = ref(localStorage.getItem('somity_locale') === 'bn' ? 'bn' : 'en');
const dictionary: Record<string, string> = { Societies: 'সমিতিসমূহ', Overview: 'সারসংক্ষেপ', Members: 'সদস্য', 'Team & access': 'টিম ও অনুমতি', 'My dashboard': 'আমার ড্যাশবোর্ড', 'Sign out': 'লগ আউট', 'Add member': 'সদস্য যোগ করুন', 'Total members': 'মোট সদস্য', 'Active members': 'সক্রিয় সদস্য', 'Portal access': 'লগইন সুবিধা', 'Inactive members': 'অন্যান্য সদস্য', 'Member directory': 'সদস্য তালিকা', 'Search members': 'সদস্য খুঁজুন', 'All statuses': 'সব স্ট্যাটাস', Active: 'সক্রিয়', Inactive: 'নিষ্ক্রিয়', Suspended: 'স্থগিত' };
export function useLocale() {
  function toggle() { locale.value = locale.value === 'en' ? 'bn' : 'en'; localStorage.setItem('somity_locale', locale.value); document.documentElement.lang = locale.value; }
  const t = (text: string) => locale.value === 'bn' ? dictionary[text] ?? text : text;
  return { locale, toggle, t };
}
