import { ref } from 'vue';
const locale = ref(localStorage.getItem('somity_locale') === 'bn' ? 'bn' : 'en');
const dictionary: Record<string, string> = { 'Activity log': 'কার্যক্রমের লগ', Finance: 'অর্থ ব্যবস্থাপনা', Loans: 'ঋণ', Investments: 'বিনিয়োগ', Income: 'আয়', 'Other income': 'অন্যান্য আয়', 'Investment profit': 'বিনিয়োগের মুনাফা', 'Total income': 'মোট আয়', Expenses: 'খরচ', Bank: 'ব্যাংক', Approvals: 'অনুমোদন', Societies: 'সমিতিসমূহ', Overview: 'সারসংক্ষেপ', Members: 'সদস্য', 'Team & access': 'টিম ও অনুমতি', 'My dashboard': 'আমার ড্যাশবোর্ড', 'Sign out': 'লগ আউট', 'Dark mode': 'ডার্ক মোড', 'Switch to light mode': 'লাইট মোড চালু করুন', 'Switch to dark mode': 'ডার্ক মোড চালু করুন', 'Add member': 'সদস্য যোগ করুন', 'Total members': 'মোট সদস্য', 'Active members': 'সক্রিয় সদস্য', 'Portal access': 'লগইন সুবিধা', 'Inactive members': 'অন্যান্য সদস্য', 'Member directory': 'সদস্য তালিকা', 'Search members': 'সদস্য খুঁজুন', 'All statuses': 'সব স্ট্যাটাস', Active: 'সক্রিয়', Inactive: 'নিষ্ক্রিয়', Suspended: 'স্থগিত' };
Object.assign(dictionary, {
  'Final settlement': 'চূড়ান্ত নিষ্পত্তি',
  'View dues statement': 'দেনা–পাওনার হিসাব দেখুন',
  'Dues and receivables': 'দেনা–পাওনার বিস্তারিত হিসাব',
  'Somity owes the member': 'সদস্য সমিতির কাছে পাবেন',
  'Member owes Somity': 'সমিতি সদস্যের কাছে পাবে',
  'Opening balance': 'শুরুর বাকি',
  'Closing balance': 'শেষের বাকি',
  'Savings received': 'সঞ্চয় জমা',
  'Savings paid out': 'সঞ্চয় ফেরত',
  'Loan disbursed': 'ঋণ বিতরণ',
  'Loan repaid': 'ঋণ পরিশোধ',
  'Savings deposit': 'সঞ্চয় জমা',
  'Savings withdrawal': 'সঞ্চয় উত্তোলন',
  'Loan disbursement': 'ঋণ বিতরণ',
  'Loan repayment': 'ঋণ পরিশোধ',
  Loan: 'ঋণ',
  Reversal: 'বিপরীত এন্ট্রি',
  Reverses: 'মূল লেনদেন',
  'Posted member transactions': 'খাতায় অন্তর্ভুক্ত সদস্য লেনদেন',
  'Member paid': 'সদস্য দিয়েছেন',
  'Somity paid': 'সমিতি দিয়েছে',
  'Savings balance after entry': 'লেনদেনের পর সঞ্চয়ের বাকি',
  'Loan balance after entry': 'লেনদেনের পর ঋণের বাকি',
  'From date': 'শুরুর তারিখ',
  'To date': 'শেষ তারিখ',
  'Apply dates': 'তারিখ অনুযায়ী দেখুন',
  'Loading statement…': 'হিসাব লোড হচ্ছে…',
  'No posted member transactions in this period.': 'এই সময়ে খাতায় কোনো সদস্য লেনদেন নেই।',
  Refresh: 'হালনাগাদ করুন',
  Page: 'পৃষ্ঠা',
  Previous: 'আগের পৃষ্ঠা',
  Next: 'পরের পৃষ্ঠা',
});
export function useLocale() {
  function toggle() { locale.value = locale.value === 'en' ? 'bn' : 'en'; localStorage.setItem('somity_locale', locale.value); document.documentElement.lang = locale.value; }
  const t = (text: string) => locale.value === 'bn' ? dictionary[text] ?? text : text;
  return { locale, toggle, t };
}
