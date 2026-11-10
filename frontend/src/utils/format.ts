export function date(value: string) { return new Intl.DateTimeFormat('en-BD', { dateStyle: 'medium', timeZone: 'Asia/Dhaka' }).format(new Date(value)); }
export function initials(name: string) { return name.split(' ').filter(Boolean).slice(0, 2).map(v => v.charAt(0)).join('').toUpperCase(); }
