import { ref } from 'vue';
const locale = ref(localStorage.getItem('somity_locale') === 'bn' ? 'bn' : 'en');
const dictionary: Record<string, string> = { 'Activity log': 'কার্যক্রমের লগ', Finance: 'অর্থ ব্যবস্থাপনা', Loans: 'ঋণ', Investments: 'বিনিয়োগ', Income: 'আয়', 'Other income': 'অন্যান্য আয়', 'Investment profit': 'বিনিয়োগের মুনাফা', 'Total income': 'মোট আয়', Expenses: 'খরচ', Bank: 'ব্যাংক', Approvals: 'অনুমোদন', Societies: 'সমিতিসমূহ', Overview: 'সারসংক্ষেপ', Members: 'সদস্য', 'Team & access': 'টিম ও অনুমতি', 'My dashboard': 'আমার ড্যাশবোর্ড', 'Sign out': 'লগ আউট', 'Dark mode': 'ডার্ক মোড', 'Switch to light mode': 'লাইট মোড চালু করুন', 'Switch to dark mode': 'ডার্ক মোড চালু করুন', 'Add member': 'সদস্য যোগ করুন', 'Total members': 'মোট সদস্য', 'Active members': 'সক্রিয় সদস্য', 'Portal access': 'লগইন সুবিধা', 'Inactive members': 'অন্যান্য সদস্য', 'Member directory': 'সদস্য তালিকা', 'Search members': 'সদস্য খুঁজুন', 'All statuses': 'সব স্ট্যাটাস', Active: 'সক্রিয়', Inactive: 'নিষ্ক্রিয়', Suspended: 'স্থগিত' };
export function useLocale() {
  function toggle() { locale.value = locale.value === 'en' ? 'bn' : 'en'; localStorage.setItem('somity_locale', locale.value); document.documentElement.lang = locale.value; }
  const t = (text: string) => locale.value === 'bn' ? dictionary[text] ?? text : text;
  return { locale, toggle, t };
}
